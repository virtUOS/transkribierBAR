# Transcription Settings

The settings appear in **Upload** once you have chosen a file, and in **Record** once the recording has been uploaded. They are arranged in groups.

![The transcription settings with the advanced options shown; numbered markers highlight the four groups](shots/settings.png)

1. **Presets**: load a saved preset, save the current settings or choose a bundle (see "Presets" below).
2. **Transcription**: the language and the model (see "Language and model").
3. **Speakers**: speaker detection and the number of people (see "Detecting speakers").
4. **Advanced options**: initial prompt and hotwords (see "Advanced options").

## Language and model

The **Transcription** group has two fields.

**Transcription language:** The default is **Auto-detect**; the speech recognition then determines the language by itself. If you know the language, choose it from the list. German, English, Spanish, French and Turkish are at the top, followed by a divider and all other languages in alphabetical order. The speech recognition determines the language from the first 30 seconds of the recording; if those contain music, silence or another language, it can guess wrong. With **Auto-detect**, the detail view shows the detected language below the title.

**Quality:** The list offers the configured models, each with a short description and its name, for example **Balanced (large-v3-turbo)** and **Best quality (large-v3)**. The default is {{default_model}}. **Best quality** is the full model and takes noticeably longer; **Balanced** is the smaller, faster model. If your installation offers only one model, the field is named **Model**, is read-only and shows it.

## Detecting speakers

The **Speakers** group has the switch **Detect speakers**. It is on by default and separates the contributions of different people. If only one person speaks, you can turn it off.

When the switch is on, you can narrow down the number of people: **Min speakers** (default 1) and **Max speakers** (default 2). Values from 1 to 20 are allowed. If you set the minimum above the maximum, the maximum follows, and the other way round.

You give names to the detected people after the transcription, in the **Subtitles** tab under **Speaker Names**.

## Advanced options

**Advanced options** reveals two more fields. Both are optional.

- **Initial prompt:** context for the transcription, for example the topic or proper names.
- **Hotwords:** comma-separated technical terms.

Both entries go to the speech recognition. Empty fields are not sent.

The two fields share a limited space, because the speech recognition puts both in front of every section of the recording. Below the fields you see how much of that space they use. If they are too long together, a note says so in red, and both the button that starts the transcription and **Save as preset** stay disabled until you shorten them. The note also appears while the advanced options are closed, for example after you have chosen a preset with long entries.

## Presets

The **Presets** group is the first group.

- **Transcription:** This selection field appears once you have saved presets. If you choose a preset there, it applies language, speakers, initial prompt and hotwords.
- **Save as preset:** Enter a name and confirm with the check mark or Enter. transkribierBAR saves the current settings under that name.
- **Bundles:** This field appears once you have created bundles. The section "Upload" explains what it does.

You manage presets on the **Presets** page in the header.

## The summary

After you click **Transcribe**, one line replaces the settings. It names the filename, the size, the model, the language (**auto** if you chose none), the speakers (**no speakers** or, for example, **1–2 speakers**) and, if used, the bundle.
