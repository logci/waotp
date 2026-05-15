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
3. The HTTP response shows the same OTP with a robust copy button and a select fallback for browsers that block clipboard access.
4. The WhatsApp message includes a native copy OTP button when WhatsApp accepts interactive buttons.
5. If WhatsApp cannot send the button payload, the app automatically falls back to a plain text OTP message.

WhatsApp message format:

```text
🌸 *Your OTP is: {otp}*

⏳ Expires in 5 minutes.
⚠️ Never share this code with anyone.
```

Use country code with the number and do not include `+`, spaces, or dashes.

## Waiting for this message

If the recipient's WhatsApp client shows `Waiting for this message. This may take a while. Learn more`, it is a WhatsApp client-side decryption/sync state. The endpoint now keeps the OTP visible on the response page with a copy/select fallback, and the bot falls back to plain text if the native copy-button send fails.

## JSON Response

Add `?format=json` if you want JSON instead of the HTML copy-button page:

```text
https://your-heroku-app.herokuapp.com/num=919876543210?format=json
```

The JSON response includes `copyButtonSent` so clients can see whether the WhatsApp native copy button was accepted.

## Heroku

Set `SESSION_ID` in Heroku config vars, deploy the app, and use your Heroku app URL as the API base URL.
