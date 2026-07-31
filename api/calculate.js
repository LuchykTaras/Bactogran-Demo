export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json(
        {
          status: 'error',
          message: 'Method not allowed'
        },
        {
          status: 405
        }
      );
    }

    try {
      const payload = await request.json();

      if (!payload.token) {
        return Response.json(
          {
            status: 'error',
            message: 'Відсутній персональний токен.'
          },
          {
            status: 400
          }
        );
      }

      const appsScriptUrl =
        process.env.APPS_SCRIPT_URL;

      if (!appsScriptUrl) {
        throw new Error(
          'У Vercel не налаштовано APPS_SCRIPT_URL.'
        );
      }

      const appsScriptResponse = await fetch(
        appsScriptUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          redirect: 'follow'
        }
      );

      const responseText =
        await appsScriptResponse.text();

      return new Response(responseText, {
        status: 200,
        headers: {
          'Content-Type':
            'application/json; charset=utf-8'
        }
      });

    } catch (error) {
      return Response.json(
        {
          status: 'error',
          message:
            error.message ||
            'Не вдалося виконати розрахунок.'
        },
        {
          status: 500
        }
      );
    }
  }
};