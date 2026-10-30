# Getting Started

## The flow

![Flow: overview, then Upload or Record, then the detail view with editor and analysis](./assets/main-flow.svg)

You start in the overview of your transcriptions. From there you upload a file or record in the browser. You work on the finished transcription in the detail view.

## Your first transcription

1. In the overview, click **+ Upload** and choose an audio or video file. Or click **+ Record** to record in the browser; when you stop, transkribierBAR uploads the recording automatically. **+ Record** only appears if your browser supports recording.
2. Choose the **Transcription language**. The default is **Auto-detect**. Under **Quality**, choose the model; the default is {{default_model}}. If your installation offers only one model, the field is named **Model** and shows it.
3. **Detect speakers** is on and separates the contributions of different people. If only one person speaks, you can turn it off.
4. Click **Transcribe**. If the upload is still running, the button reads **Transcribe when ready**; the transcription then starts by itself once the file is uploaded.
5. Wait until the transcription is done. The status shows **Queued…** while it waits and **Transcribing…** while it runs.
6. If you stayed on the page, the finished transcription opens in the detail view by itself. Otherwise click it in the overview.

> **Leaving the page?** While a file is uploading, leaving the page cancels the upload. Once the transcription is running, you can leave the page; it continues on the server.

## The detail view

The player plays the recording. Below it, choose a tab:

- **Subtitles:** correct the text and name the speakers under **Speaker Names**. This is also where you start **Refine with LLM** and **Translate**.
- **Analysis:** create a summary, meeting minutes or your own analysis.
- **SRT**, **VTT**, **JSON** and **TXT:** view the result in that format and download it.

## Where to find things

The header contains:

- **?** opens this help at the section for the current view.
- **Presets** manages your saved presets.
- **Settings** manages your API tokens.
- **DE** switches the interface to German.
- **Logout** signs you out.

On narrow screens these items are in the **Menu** (the icon with three lines). From any other view, **← Transcriptions** takes you back to the overview.
