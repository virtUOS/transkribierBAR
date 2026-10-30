# Upload

## Choosing a file

In the overview, click **+ Upload**. Then drag a file onto the upload area or click it to open the file browser. The upload starts as soon as you choose the file.

MP3, WAV, MP4, WebM, M4A, MOV, AAC, Opus and OGG files up to 1 GB are allowed. If the file is larger, the message **File is too large. Maximum size is 1 GB.** appears. While the upload runs, the area reads **Uploading file — please wait...**. Afterwards the page shows the filename with the file size.

## Settings and starting

As soon as you have chosen a file, the settings appear, even while the upload is still running.

![The upload page after choosing a file, with the settings and the buttons to start; numbered markers highlight the controls](shots/upload.png)

1. The settings. The section "Transcription Settings" explains the fields; the **Bundles** field is explained under "Using bundles" below.
2. **Transcribe** starts the transcription.
3. **Discard** resets the page and returns you to the overview.

If the upload is still running, the button reads **Transcribe when ready**; the transcription then starts by itself once the file is uploaded. If the upload fails in that case, **Upload failed** appears with the button **Edit settings**.

## Using bundles

A bundle links presets for transcription, refinement, analysis and translation. If you have created bundles, pick one under **Presets** in the **Bundles** field. If a bundle is marked as the default, the app preselects it when it opens and applies its transcription preset to the settings, just as if you had chosen the bundle yourself. If you mark a bundle as the default while the app is open, the **Bundles** field shows it, but its transcription preset is only applied the next time the app opens. To apply it right away, first select **Select a bundle...** and then the bundle.

If the bundle includes refinement, analysis or translation, the button reads **Run pipeline**. Your browser starts those steps automatically after the transcription. Stay on the page until they have finished. You create bundles on the **Presets** page.

## Leaving the page

While the file is uploading, transkribierBAR asks before you switch to another view: **An upload is in progress. Leaving this page will cancel it. Continue?** If you confirm, the upload is canceled. If you close the tab or reload the page, the browser warns you.

Once the transcription is running, you can leave the page. It continues on the server and appears in the overview later. This does not apply to the steps of a bundle: they only run while the page stays open. If you open the transcription again in the same tab, the steps start then.

> **Large files.** An uploaded file alone does not appear in the overview. Click **Transcribe when ready** while the upload is still running and keep the tab open until the upload has finished. Once the transcription is running, you can leave the page.

## If the transcription fails

If the transcription fails, **Transcription failed** appears with the reason after **Error message:**, for example:

- **The speech recognition did not finish this transcription within the time limit.**
- **The request to the speech recognition failed.**
- **The speech recognition reported an error for this transcription.**
- **The server restarted while this transcription was running.**

If the language was set to Auto-detect and the speech recognition reported an error, it also says: **The language was set to Auto-detect. Choosing the language may help.**

**Try again** takes you back to the settings for the same file. Change what is needed there, for example the language, and click **Transcribe**. You do not have to upload the file again.

The failed transcription stays in the overview with the red status "Failed". If you open it there, its page shows the same notice with the reason and **Try again**. A new transcription of the same file appears as an entry of its own. You remove the failed one with **Delete transcription** on its page; the file is kept as long as another transcription uses it.

If the transcription fails repeatedly, write to [{{contact_email}}](mailto:{{contact_email}}).
