# Format Viewer

## The four formats

Next to **Subtitles**, the detail view has the tabs **SRT**, **VTT**, **JSON** and **TXT**. Each shows the transcript in that format. transkribierBAR creates it in your browser from the current text.

- **SRT:** numbered entries with times such as `00:01:30,250 --> 00:01:34,000`. The text starts with the speaker's name in square brackets: `[Name]: Text`.
- **VTT:** starts with `WEBVTT` and has times with a full stop instead of a comma (`00:01:30.250`). The names are in square brackets as in SRT.
- **JSON:** a list with `start`, `end`, `text` and `speaker` for each utterance. Start and end are milliseconds.
- **TXT:** one line per utterance without times, in the form `Name: Text`.

Utterances without a speaker appear without a name.

## Downloading

Each format tab has a preview and a download button.

![The SRT tab with the preview and the download button; numbered markers highlight the controls](shots/formats.png)

1. The **SRT** tab. **VTT**, **JSON** and **TXT** work the same way.
2. The preview, which you cannot change.
3. **Download SRT** saves the file. The same button appears below the preview.

The file gets the recording's name without its extension plus the file extension of the format, such as `Lecture.srt`. If the name is missing, the file is called `transcription.srt`.

## What the format contains

The format shows the state you see in the editor, including unsaved changes. Names from **Speaker Names** are filled in in all four formats and in every view.

Which version appears depends on the view you last chose in the **Subtitles** tab: **Original**, **Refined** or **Translated**. If **Refined** is chosen, the JSON format contains both versions in one object: `utterances` for the original and `refined_utterances` for the refined version.

## Which format fits?

| Goal | Format |
|---|---|
| Add subtitles to a video | SRT or VTT |
| Process the transcript with a program | JSON |
| Read or pass on the transcript | TXT |
