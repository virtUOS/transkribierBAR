# Archive

## My Transcriptions

After signing in you see the overview. Under **My Transcriptions** it lists all your transcriptions, newest first.

![The overview with two transcriptions; numbered markers highlight the parts of a row](shots/archive.png)

1. The title with the filename below it, or only the filename if there is no title. The pencil icons next to them rename them (see "Renaming").
2. The model, the status, the creation date and, if the transcription is archived, a shield icon. The status is green "Completed", yellow "Pending" or "Processing" (waiting or running), or red "Failed".

Click a row to open the transcription. After transcribing, transkribierBAR creates the title automatically with the language model. If that fails, the row shows only the filename.

If you have no transcriptions yet, you see **New here?** with the link **Open the Getting Started guide** instead.

## Renaming

Click the pencil icon next to the title (**Edit title**) or next to the filename (**Edit filename**). Enter or clicking elsewhere saves, Esc cancels. The file extension stays as it is.

## Expiry and archiving

The period applies to the uploaded file: once it has passed, the file is deleted automatically, together with all transcriptions and results that belong to it (analyses, refinement, translation, speaker names). The period is {{retention_days}} days from the upload. The detail view shows the date after **Expires:**; it turns red when less than 24 hours are left.

**Archive** in the detail view sets the period to {{archive_retention_days}} days from that moment. The button is then replaced by **Archived**, and the overview shows the shield icon.

> **Download in time.** Once the period has passed, you cannot restore the transcription. Download any results you want to keep before then.

## Deleting

**Delete transcription** in the detail view asks for confirmation and then deletes the transcription and its results at once. The uploaded file is deleted too, unless another transcription uses it. Deleting cannot be undone. You then return to the overview.
