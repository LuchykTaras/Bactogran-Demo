/**
 * Vercel Function: /api/app-data
 * Розмістити як api/app-data.js.
 * Використовує той самий URL Apps Script, що й /api/calculate.
 */
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({
      status: 'error',
      message: 'Method Not Allowed'
    });
  }

  const appsScriptUrl =
    process.env.APPS_SCRIPT_URL ||
    process.env.GOOGLE_APPS_SCRIPT_URL;

  if (!appsScriptUrl) {
    return response.status(500).json({
      status: 'error',
      message: 'Не задано URL Apps Script.'
    });
  }

  try {
    const url = new URL(appsScriptUrl);
    url.searchParams.set('action', 'appData');

    const upstream = await fetch(
      url.toString(),
      {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'Accept': 'application/json'
        },
        cache: 'no-store'
      }
    );

    const text = await upstream.text();

    let payload;

    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(
        'Apps Script повернув не JSON.'
      );
    }

    if (
      !upstream.ok ||
      payload.status !== 'success'
    ) {
      return response.status(502).json({
        status: 'error',
        message:
          payload.message ||
          'Не вдалося отримати довідники.'
      });
    }

    response.setHeader(
      'Cache-Control',
      'no-store, max-age=0'
    );

    return response.status(200).json(payload);

  } catch (error) {
    return response.status(500).json({
      status: 'error',
      message:
        error && error.message
          ? error.message
          : 'Помилка завантаження довідників.'
    });
  }
}
