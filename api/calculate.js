export default {
  async fetch(request) {
    const responseHeaders = {
      'Cache-Control':
        'no-store, no-cache, must-revalidate'
    };

    if (request.method !== 'POST') {
      return Response.json(
        {
          status: 'error',
          message:
            'Метод не підтримується. Очікується POST.'
        },
        {
          status: 405,
          headers: {
            ...responseHeaders,
            Allow: 'POST'
          }
        }
      );
    }

    const appsScriptUrl =
      process.env.APPS_SCRIPT_URL;

    if (!appsScriptUrl) {
      console.error(
        'APPS_SCRIPT_URL is not configured'
      );

      return Response.json(
        {
          status: 'error',
          message:
            'Не налаштовано адресу сервера розрахунку.'
        },
        {
          status: 500,
          headers: responseHeaders
        }
      );
    }

    try {
      /*
       * Беремо тіло POST-запиту без змін.
       */
      const requestBody =
        await request.text();

      /*
       * Важливо:
       * не Response.redirect(),
       * а серверний fetch із POST.
       */
      const appsScriptResponse =
        await fetch(
          appsScriptUrl,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: requestBody,

            redirect: 'follow'
          }
        );

      const responseText =
        await appsScriptResponse.text();

      let responseData;

      try {
        responseData =
          JSON.parse(responseText);
      } catch (parseError) {
        console.error(
          'Apps Script returned non-JSON:',
          {
            status:
              appsScriptResponse.status,

            contentType:
              appsScriptResponse.headers.get(
                'content-type'
              ),

            body:
              responseText.slice(0, 500)
          }
        );

        return Response.json(
          {
            status: 'error',
            message:
              'Сервер розрахунку повернув відповідь у неправильному форматі.'
          },
          {
            status: 502,
            headers: responseHeaders
          }
        );
      }

      return Response.json(
        responseData,
        {
          status: 200,
          headers: responseHeaders
        }
      );

    } catch (error) {
      console.error(
        'Calculate proxy error:',
        error
      );

      return Response.json(
        {
          status: 'error',
          message:
            'Не вдалося з’єднатися із сервером розрахунку.'
        },
        {
          status: 502,
          headers: responseHeaders
        }
      );
    }
  }
};