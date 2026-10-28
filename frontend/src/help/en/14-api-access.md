# API Access

## What this is for

With a personal API token, your own scripts can use transkribierBAR without the web interface: upload a file, start a transcription, query its status and download the result. This section is for people who write scripts. For the web interface, you do not need it.

A token belongs to your account. A script that uses it sees and changes only your own files and transcriptions. It does what you could do in the web interface.

## Creating a token

Click **Settings** in the header. In the **API tokens** section, click **Create token**. Enter a **Name** that tells you where you use the token, for example the name of the script. Under **Expires in**, choose how long the token stays valid. The list offers **30 days**, **90 days** and **365 days**, and always also the default validity of {{api_token_expiry_days}} days, which is preselected. Every token expires. Click **Create**.

The name can be up to 64 characters long. Among your active tokens each name may only be used once. The number of active tokens per person is limited. If you have reached it, creating another one is refused with an error message in the dialog. Revoke a token you no longer need first.

Tokens are created, listed and revoked only in the web interface. A request to `/api/tokens` that carries a token is answered with status 403.

> **Copy the token now.** The token appears once, starting with `tw_`. **Copy** puts it on the clipboard, **Done** closes the dialog. After that, nobody can display the token again, because transkribierBAR only stores a hash of it, not the token itself. If you lose it, create a new one.

## Managing tokens

The **API tokens** section lists your tokens.

![The API tokens section with one active token; numbered markers highlight the controls](shots/tokens.png)

1. **Create token** opens the dialog described above.
2. A token with its name, its first characters followed by "…", its status (**Active**, **Expired** or **Revoked**), its expiry date and, once it has been used, when it was last used.
3. **Revoke**, next to an active or expired token, revokes it. From then on, the server rejects every new request with it.

Expired and revoked tokens stay in the list, shown faded. They are removed from it automatically, revoked ones after 30 days and expired ones after 90 days.

Before a token expires, a notice above the list names it, and the **Settings** button in the header shows an orange dot. The notice appears 14 days before the expiry, for a token created for only a short time 3 days or 1 day before, and it stays for 14 days after a token has expired. A token valid for 1 day gets a notice only once it has expired. Revoking a token removes its notice, even after the token has expired; once no notice is left, the dot disappears as well. A token cannot be extended: create a new one and replace the old one in your scripts. If this service is set up to send email, you also receive reminders at the email address of your login, 14, 3 and 1 day before a token expires; a token created for only a short time skips the early ones, and a token valid for 1 day gets none.

## Authentication

Send the token with every request in the header `Authorization`, in the form `Bearer` followed by a space and the token:

```
Authorization: Bearer tw_…
```

If the token is unknown, expired or revoked, the server answers with status 401 and the message **Invalid or expired API token**.

For the WebSocket that reports the status, send the token as the query parameter `token`, because browsers cannot set headers there:

```
wss://transcription.uni-osnabrueck.de/api/ws/status/{transcription_id}?token=tw_…
```

## Transcribing step by step

The examples use `tw_…` as a placeholder for your token and `FILE_ID` and `TRANSCRIPTION_ID` for the IDs you receive.

**1. Upload the file.** Send it as the form field `file`:

```
curl -H "Authorization: Bearer tw_…" -F "file=@interview.mp3" https://transcription.uni-osnabrueck.de/api/upload
```

The answer is JSON. The field `id` is the `FILE_ID`. The same file types and the same maximum size as in the web interface apply, see the section "Upload". Other file types are answered with status 400, files that are too large with 413.

**2. Start the transcription.** Send the settings as JSON:

```
curl -X POST https://transcription.uni-osnabrueck.de/api/transcribe \
  -H "Authorization: Bearer tw_…" \
  -H "Content-Type: application/json" \
  -d '{"file_id": "FILE_ID", "language": "de", "model": "{{default_model}}"}'
```

The answer contains the `id` of the transcription (`TRANSCRIPTION_ID`) and the status `pending`. These fields are available:

| Field | Meaning |
| --- | --- |
| `file_id` | Required. The `id` from the upload. |
| `language` | Language code such as `de`. Without this field, the language is detected automatically. |
| `model` | The model. See the note below. |
| `min_speakers`, `max_speakers` | Minimum and maximum number of speakers. If at least one of them is greater than 0, speakers are detected. If both are missing or 0, speakers are not detected. |
| `initial_prompt` | Optional context for the transcription. |
| `hotwords` | Optional technical terms, separated by commas. |

> **The model.** `model` names one of the models this installation offers; the **Quality** field in **Upload** lists them with their names in parentheses. If you leave out `model`, the installation's default model {{default_model}} is used. A model this installation does not offer is rejected with status 422, and the message names the rejected model.

**3. Wait for the result.** Query the status until it is `completed` or `failed`:

```
curl -H "Authorization: Bearer tw_…" https://transcription.uni-osnabrueck.de/api/status/TRANSCRIPTION_ID
```

The status is `pending`, `processing`, `completed` or `failed`. With `failed`, the field `error` contains the reason, and `error_code` names it with a fixed code: `server_restarted` (the server restarted while the transcription was running), `timeout` (the speech recognition did not finish within the time limit), `asr_unreachable` (the request to the speech recognition failed), `asr_failed` (the speech recognition reported an error) or `unknown` (any other reason, which only `error` describes). If no code is stored, `error_code` is `null`.

Instead of repeating the query, you can listen on the WebSocket from the section "Authentication". It sends a message such as `{"type": "status", "status": "processing"}` every 5 seconds and closes after `failed`. If the transcription already has a title, the `completed` message carries it in the field `title`, and the WebSocket closes. The language model writes the title only after the transcription, though. While it is still working on the title, the WebSocket stays open after `completed` and checks every 5 seconds. As soon as the attempt has ended, it sends `{"type": "title", "title": "…"}` if the attempt produced a title, and closes. It closes at the latest when the language model's time limit has passed since the transcription was completed. Without a language model, and for a transcription without text, it closes right after `completed`. If the token is invalid, it closes with code 4001. If the transcription does not exist or is not yours, it closes with code 4003.

**4. Fetch the result.** As long as the transcription is not finished, this call is answered with status 400:

```
curl -H "Authorization: Bearer tw_…" https://transcription.uni-osnabrueck.de/api/transcription/TRANSCRIPTION_ID
```

The answer contains the utterances (`utterances`, each with `start` and `end` in milliseconds, `text` and `speaker`), the complete text (`text`), the language (`language`) and the speaker names (`speaker_mappings`). For a ready-made file, append `/export/txt`, `/export/srt`, `/export/vtt` or `/export/json` to the address instead.

## Limits

Files and results are deleted automatically after {{retention_days}} days, as in the web interface.

Presets and bundles are applied by the web interface. `/api/transcribe` does not know them, so you send the settings yourself. The calls for presets accept a token as well.
