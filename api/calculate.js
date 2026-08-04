const REQUEST_CACHE_TTL_MS =
  5 * 60 * 1000;

const UPSTREAM_TIMEOUT_MS =
  40 * 1000;


/*
 * Тимчасовий кеш усередині активного
 * інстансу Vercel.
 *
 * Він допомагає не запускати повторний
 * розрахунок, якщо мобільний браузер
 * повторно відправив той самий requestId.
 */
const requestCache =
  globalThis.__bactogranRequestCache ||
  new Map();

globalThis.__bactogranRequestCache =
  requestCache;


/**
 * Видаляє прострочені записи з кешу.
 */
function cleanupRequestCache() {
  const now =
    Date.now();

  for (
    const [key, entry]
    of requestCache.entries()
  ) {
    if (
      !entry ||
      !entry.expiresAt ||
      entry.expiresAt <= now
    ) {
      requestCache.delete(
        key
      );
    }
  }
}


/**
 * Формує стандартну JSON-відповідь.
 */
function createJsonResponse(
  payload,
  status,
  responseHeaders,
  requestId
) {
  return Response.json(
    payload,
    {
      status: status,

      headers: {
        ...responseHeaders,

        'X-Request-Id':
          requestId || ''
      }
    }
  );
}


/**
 * Очищає requestId від небезпечних символів.
 */
function normalizeRequestId(
  value
) {
  const requestId =
    String(
      value || ''
    )
      .trim()
      .replace(
        /[^a-zA-Z0-9._:-]/g,
        ''
      )
      .slice(
        0,
        160
      );

  return (
    requestId ||
    null
  );
}


/**
 * Перевіряє адресу Google Apps Script.
 *
 * Очікується активна адреса вебпрограми,
 * яка закінчується на /exec.
 */
function validateAppsScriptUrl(
  value
) {
  try {
    const url =
      new URL(
        String(
          value || ''
        ).trim()
      );

    return (
      url.protocol ===
        'https:' &&

      url.hostname ===
        'script.google.com' &&

      url.pathname.endsWith(
        '/exec'
      )
    );

  } catch (error) {
    return false;
  }
}


/**
 * Передає POST-запит у Google Apps Script.
 */
async function forwardToAppsScript(
  appsScriptUrl,
  requestBody,
  requestId
) {
  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      function () {
        controller.abort();
      },
      UPSTREAM_TIMEOUT_MS
    );

  try {
    /*
     * Важливо:
     * це серверний POST-запит.
     *
     * Браузер користувача не перенаправляється
     * безпосередньо в Google Apps Script.
     */
    const appsScriptResponse =
      await fetch(
        appsScriptUrl,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            'X-Request-Id':
              requestId || ''
          },

          body:
            requestBody,

          /*
           * Google Apps Script ContentService
           * може перенаправити відповідь на
           * script.googleusercontent.com.
           */
          redirect:
            'follow',

          cache:
            'no-store',

          signal:
            controller.signal
        }
      );

    const responseText =
      await appsScriptResponse.text();


    /*
     * Google повернув порожню відповідь.
     */
    if (
      !responseText.trim()
    ) {
      return {
        httpStatus:
          502,

        payload: {
          status:
            'error',

          code:
            'UPSTREAM_EMPTY_RESPONSE',

          retryable:
            true,

          message:
            'Сервер розрахунку не повернув відповідь. Виконуємо повторну спробу.'
        }
      };
    }


    let responseData;


    /*
     * Перевіряємо, що Google повернув JSON.
     */
    try {
      responseData =
        JSON.parse(
          responseText
        );

    } catch (parseError) {
      console.error(
        'Apps Script returned non-JSON:',
        {
          requestId:
            requestId,

          status:
            appsScriptResponse.status,

          contentType:
            appsScriptResponse
              .headers
              .get(
                'content-type'
              ),

          body:
            responseText.slice(
              0,
              500
            )
        }
      );

      return {
        httpStatus:
          502,

        payload: {
          status:
            'error',

          code:
            'UPSTREAM_NON_JSON',

          retryable:
            true,

          message:
            'Сервер розрахунку повернув некоректну відповідь. Виконуємо повторну спробу.'
        }
      };
    }


    /*
     * Захист від ситуації, коли замість
     * doPost() виконався doGet().
     */
    if (
      responseData &&
      responseData.status ===
        'active'
    ) {
      console.error(
        'Apps Script doGet response received instead of doPost:',
        {
          requestId:
            requestId,

          response:
            responseData
        }
      );

      return {
        httpStatus:
          502,

        payload: {
          status:
            'error',

          code:
            'UPSTREAM_GET_INSTEAD_OF_POST',

          retryable:
            true,

          message:
            'Сервер тимчасово відкрив перевірочний маршрут замість розрахунку. Виконуємо повторну спробу.'
        }
      };
    }


    /*
     * Нормальна відповідь Apps Script.
     *
     * Зберігаємо її структуру без змін:
     * status, data, message тощо.
     */
    return {
      httpStatus:
        200,

      payload:
        responseData
    };

  } catch (error) {
    const isTimeout =
      error &&
      error.name ===
        'AbortError';

    console.error(
      'Calculate proxy error:',
      {
        requestId:
          requestId,

        name:
          error &&
          error.name,

        message:
          error &&
          error.message
      }
    );

    return {
      httpStatus:
        502,

      payload: {
        status:
          'error',

        code:
          isTimeout
            ? 'UPSTREAM_TIMEOUT'
            : 'UPSTREAM_CONNECTION_ERROR',

        retryable:
          true,

        message:
          isTimeout
            ? 'Сервер розрахунку відповідає довше звичайного. Виконуємо повторну спробу.'
            : 'Тимчасово не вдалося з’єднатися із сервером розрахунку. Виконуємо повторну спробу.'
      }
    };

  } finally {
    clearTimeout(
      timeoutId
    );
  }
}


/**
 * Основний обробник Vercel Function.
 */
export default {
  async fetch(request) {
    const responseHeaders = {
      'Cache-Control':
        'no-store, no-cache, must-revalidate',

      'Pragma':
        'no-cache',

      'Expires':
        '0'
    };


    cleanupRequestCache();


    /*
     * API приймає тільки POST.
     */
    if (
      request.method !==
        'POST'
    ) {
      return createJsonResponse(
        {
          status:
            'error',

          code:
            'METHOD_NOT_ALLOWED',

          retryable:
            false,

          message:
            'Метод не підтримується. Очікується POST.'
        },

        405,

        {
          ...responseHeaders,

          Allow:
            'POST'
        },

        ''
      );
    }


    const appsScriptUrl =
      process.env
        .APPS_SCRIPT_URL;


    /*
     * Перевірка змінної середовища Vercel.
     */
    if (
      !validateAppsScriptUrl(
        appsScriptUrl
      )
    ) {
      console.error(
        'APPS_SCRIPT_URL is missing or is not an active /exec URL'
      );

      return createJsonResponse(
        {
          status:
            'error',

          code:
            'INVALID_APPS_SCRIPT_URL',

          retryable:
            false,

          message:
            'Не налаштовано активну адресу сервера розрахунку.'
        },

        500,

        responseHeaders,

        ''
      );
    }


    let requestBody;
    let requestData;


    /*
     * Читаємо та перевіряємо JSON
     * із frontend.
     */
    try {
      requestBody =
        await request.text();

      requestData =
        JSON.parse(
          requestBody
        );

    } catch (error) {
      return createJsonResponse(
        {
          status:
            'error',

          code:
            'INVALID_REQUEST_JSON',

          retryable:
            false,

          message:
            'Запит містить некоректні дані.'
        },

        400,

        responseHeaders,

        ''
      );
    }


    /*
     * requestId можна передати:
     *
     * 1. у JSON;
     * 2. у заголовку X-Request-Id.
     */
    const requestId =
      normalizeRequestId(
        requestData.requestId ||
        request.headers.get(
          'X-Request-Id'
        )
      );


    /*
     * Для стабільних повторних спроб
     * requestId обов’язковий.
     */
    if (!requestId) {
      return createJsonResponse(
        {
          status:
            'error',

          code:
            'REQUEST_ID_REQUIRED',

          retryable:
            false,

          message:
            'Не вдалося ідентифікувати запит. Оновіть сторінку та повторіть розрахунок.'
        },

        400,

        responseHeaders,

        ''
      );
    }


    /*
     * Гарантовано додаємо нормалізований
     * requestId у тіло для Apps Script.
     */
    requestData.requestId =
      requestId;

    requestBody =
      JSON.stringify(
        requestData
      );


    /*
     * Перевіряємо, чи цей запит уже
     * виконується або завершився.
     */
    const existing =
      requestCache.get(
        requestId
      );


    if (existing) {
      const cachedResult =
        existing.result ||
        await existing.promise;

      return createJsonResponse(
        cachedResult.payload,

        cachedResult.httpStatus,

        responseHeaders,

        requestId
      );
    }


    /*
     * Запускаємо звернення до Apps Script.
     */
    const executionPromise =
      forwardToAppsScript(
        appsScriptUrl,
        requestBody,
        requestId
      );


    /*
     * Зберігаємо Promise ще до завершення
     * запиту, щоб паралельний повтор із тим
     * самим requestId не запускав другий POST.
     */
    requestCache.set(
      requestId,
      {
        promise:
          executionPromise,

        result:
          null,

        expiresAt:
          Date.now() +
          REQUEST_CACHE_TTL_MS
      }
    );


    const result =
      await executionPromise;


    const cacheEntry =
      requestCache.get(
        requestId
      );


    /*
     * Успішний результат тимчасово
     * зберігається у кеші.
     *
     * Тимчасові помилки не кешуються,
     * щоб frontend міг зробити повторну спробу.
     */
    if (
      cacheEntry &&
      result.payload &&
      result.payload.status ===
        'success'
    ) {
      cacheEntry.result =
        result;

      cacheEntry.promise =
        Promise.resolve(
          result
        );

      cacheEntry.expiresAt =
        Date.now() +
        REQUEST_CACHE_TTL_MS;

    } else {
      requestCache.delete(
        requestId
      );
    }


    return createJsonResponse(
      result.payload,

      result.httpStatus,

      responseHeaders,

      requestId
    );
  }
};