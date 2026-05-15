# WhatsApp OTP Verification API

This app keeps one WhatsApp session connected and exposes a simple OTP sender endpoint for Heroku or any Node.js host.

## API Endpoint

```text
https://your-heroku-app.herokuapp.com/num={number}
```

Example:

```text
https://your-heroku-app.herokuapp.com/num=919876543210
```

When the endpoint is called:

1. A 6-digit OTP is generated.
2. The OTP is sent to the requested WhatsApp number.
3. The HTTP response shows the same OTP with a copy button.
4. The WhatsApp message also includes a copy OTP button.

WhatsApp message format:

```text
🌸 *Your OTP is: {otp}*

⏳ Expires in 5 minutes.
⚠️ Never share this code with anyone.
```

Use country code with the number and do not include `+`, spaces, or dashes.

## JSON Response

Add `?format=json` if you want JSON instead of the HTML copy-button page:

```text
https://your-heroku-app.herokuapp.com/num=919876543210?format=json
```

## Heroku

Set `SESSION_ID` in Heroku config vars, deploy the app, and use your Heroku app URL as the API base URL.
