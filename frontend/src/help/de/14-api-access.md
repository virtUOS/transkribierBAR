# API-Zugriff

## Wofür das gedacht ist

Mit einem persönlichen API-Token können Ihre eigenen Skripte transkribierBAR ohne die Weboberfläche nutzen: eine Datei hochladen, eine Transkription starten, ihren Status abfragen und das Ergebnis herunterladen. Dieser Abschnitt richtet sich an Personen, die Skripte schreiben. Für die Weboberfläche brauchen Sie ihn nicht.

Ein Token gehört zu Ihrem Konto. Ein Skript, das ihn verwendet, sieht und ändert nur Ihre eigenen Dateien und Transkriptionen. Es kann tun, was Sie auch in der Weboberfläche tun können.

## Token erstellen

Klicken Sie in der Kopfzeile auf **Einstellungen**. Klicken Sie im Bereich **API-Tokens** auf **Token erstellen**. Geben Sie einen **Namen** ein, der Ihnen sagt, wo Sie den Token verwenden, zum Beispiel den Namen des Skripts. Wählen Sie unter **Läuft ab**, wie lange der Token gültig bleibt. Die Liste bietet **30 Tage**, **90 Tage** und **365 Tage** und immer auch die Standard-Gültigkeit von {{api_token_expiry_days}} Tagen, die vorausgewählt ist. Jeder Token läuft ab. Klicken Sie auf **Erstellen**.

Der Name darf bis zu 64 Zeichen lang sein. Unter Ihren aktiven Tokens darf jeder Name nur einmal vorkommen. Die Zahl der aktiven Tokens pro Person ist begrenzt. Haben Sie sie erreicht, wird ein weiterer Token mit einer Fehlermeldung im Dialog abgelehnt. Widerrufen Sie dann zuerst einen Token, den Sie nicht mehr brauchen.

Tokens werden nur in der Weboberfläche erstellt, aufgelistet und widerrufen. Eine Anfrage an `/api/tokens`, die einen Token mitsendet, beantwortet der Server mit dem Status 403.

> **Token jetzt kopieren.** Der Token erscheint einmal und beginnt mit `tw_`. **Kopieren** legt ihn in die Zwischenablage, **Fertig** schließt den Dialog. Danach kann ihn niemand mehr anzeigen, denn transkribierBAR speichert nur einen Hash des Tokens, nicht den Token selbst. Haben Sie ihn verloren, erstellen Sie einen neuen.

## Tokens verwalten

Der Bereich **API-Tokens** listet Ihre Tokens auf.

![Der Bereich „API-Tokens“ mit einem aktiven Token; nummerierte Markierungen heben die Bedienelemente hervor](shots/tokens.png)

1. **Token erstellen** öffnet den oben beschriebenen Dialog.
2. Ein Token mit seinem Namen, seinen ersten Zeichen mit angehängtem „…“, dem Status (**Aktiv**, **Abgelaufen** oder **Widerrufen**), seinem Ablaufdatum und, sobald er verwendet wurde, dem Zeitpunkt der letzten Verwendung.
3. **Widerrufen** neben einem aktiven oder abgelaufenen Token widerruft ihn. Ab dann weist der Server jede neue Anfrage mit ihm ab.

Abgelaufene und widerrufene Tokens bleiben abgeblendet in der Liste. Sie werden automatisch daraus entfernt, widerrufene nach 30 Tagen und abgelaufene nach 90 Tagen.

Bevor ein Token abläuft, nennt ihn ein Hinweis über der Liste, und die Schaltfläche **Einstellungen** in der Kopfzeile zeigt einen orangen Punkt. Der Hinweis erscheint 14 Tage vor dem Ablauf, bei einem nur kurz gültigen Token 3 Tage oder 1 Tag vorher, und er bleibt 14 Tage nach dem Ablauf stehen. Für einen Token, der 1 Tag gilt, erscheint der Hinweis erst nach dem Ablauf. Widerrufen Sie einen Token, verschwindet sein Hinweis, auch wenn der Token schon abgelaufen ist; ist kein Hinweis mehr übrig, verschwindet auch der Punkt. Ein Token lässt sich nicht verlängern: Erstellen Sie einen neuen und ersetzen Sie den alten in Ihren Skripten. Ist dieser Dienst für den Versand von E-Mails eingerichtet, erhalten Sie außerdem Erinnerungen an die E-Mail-Adresse Ihres Logins, 14, 3 und 1 Tag vor dem Ablauf; bei einem nur kurz gültigen Token entfallen die frühen, und ein Token, der 1 Tag gilt, erhält keine.

## Authentifizierung

Senden Sie den Token mit jeder Anfrage im Header `Authorization`, in der Form `Bearer`, ein Leerzeichen und der Token:

```
Authorization: Bearer tw_…
```

Ist der Token unbekannt, abgelaufen oder widerrufen, antwortet der Server mit dem Status 401 und der Meldung **Invalid or expired API token**.

Für den WebSocket, der den Status meldet, übergeben Sie den Token als Query-Parameter `token`, weil Browser dort keine Header setzen können:

```
wss://transcription.uni-osnabrueck.de/api/ws/status/{transcription_id}?token=tw_…
```

## Transkribieren Schritt für Schritt

In den Beispielen steht `tw_…` als Platzhalter für Ihren Token, `FILE_ID` und `TRANSCRIPTION_ID` stehen für die IDs, die Sie erhalten.

**1. Datei hochladen.** Senden Sie sie als Formularfeld `file`:

```
curl -H "Authorization: Bearer tw_…" -F "file=@interview.mp3" https://transcription.uni-osnabrueck.de/api/upload
```

Die Antwort ist JSON. Das Feld `id` ist die `FILE_ID`. Es gelten dieselben Dateitypen und dieselbe Höchstgröße wie in der Weboberfläche, siehe Abschnitt „Hochladen“. Andere Dateitypen beantwortet der Server mit dem Status 400, zu große Dateien mit 413.

**2. Transkription starten.** Senden Sie die Einstellungen als JSON:

```
curl -X POST https://transcription.uni-osnabrueck.de/api/transcribe \
  -H "Authorization: Bearer tw_…" \
  -H "Content-Type: application/json" \
  -d '{"file_id": "FILE_ID", "language": "de", "model": "{{default_model}}"}'
```

Die Antwort enthält die `id` der Transkription (`TRANSCRIPTION_ID`) und den Status `pending`. Diese Felder gibt es:

| Feld | Bedeutung |
| --- | --- |
| `file_id` | Pflicht. Die `id` aus dem Upload. |
| `language` | Sprachcode wie `de`. Ohne dieses Feld wird die Sprache automatisch erkannt. |
| `model` | Das Modell. Siehe den Hinweis unten. |
| `min_speakers`, `max_speakers` | Mindest- und Höchstzahl der Sprechenden. Ist mindestens eines davon größer als 0, werden Sprechende erkannt. Fehlen beide oder sind sie 0, werden keine Sprechenden erkannt. |
| `initial_prompt` | Optionaler Kontext für die Transkription. |
| `hotwords` | Optionale Fachbegriffe, durch Kommas getrennt. |

> **Das Modell.** `model` nennt eines der Modelle, die diese Installation anbietet; das Feld **Qualität** bei **Hochladen** führt sie mit ihren Namen in Klammern auf. Lassen Sie `model` weg, wird das Standardmodell {{default_model}} dieser Installation verwendet. Ein Modell, das diese Installation nicht anbietet, wird mit Status 422 abgelehnt; die Meldung nennt das abgelehnte Modell.

**3. Auf das Ergebnis warten.** Fragen Sie den Status ab, bis er `completed` oder `failed` ist:

```
curl -H "Authorization: Bearer tw_…" https://transcription.uni-osnabrueck.de/api/status/TRANSCRIPTION_ID
```

Der Status ist `pending`, `processing`, `completed` oder `failed`. Bei `failed` nennt das Feld `error` den Grund, und `error_code` bezeichnet ihn mit einem festen Code: `server_restarted` (der Server wurde während der Transkription neu gestartet), `timeout` (die Spracherkennung ist nicht innerhalb des Zeitlimits fertig geworden), `asr_unreachable` (die Anfrage an die Spracherkennung ist fehlgeschlagen), `asr_failed` (die Spracherkennung hat einen Fehler gemeldet) oder `unknown` (ein anderer Grund, den nur `error` beschreibt). Ist kein Code gespeichert, ist `error_code` `null`.

Statt die Abfrage zu wiederholen, können Sie den WebSocket aus dem Abschnitt „Authentifizierung“ abhören. Er sendet alle 5 Sekunden eine Nachricht wie `{"type": "status", "status": "processing"}` und schließt sich nach `failed`. Hat die Transkription schon einen Titel, enthält die Nachricht mit `completed` ihn im Feld `title`, und der WebSocket schließt sich. Das Sprachmodell schreibt den Titel allerdings erst nach der Transkription. Solange es noch am Titel arbeitet, bleibt der WebSocket nach `completed` offen und prüft alle 5 Sekunden. Sobald der Versuch beendet ist, sendet er `{"type": "title", "title": "…"}`, falls dabei ein Titel entstanden ist, und schließt sich. Spätestens wenn das Zeitlimit des Sprachmodells seit dem Abschluss der Transkription verstrichen ist, schließt er sich. Ohne Sprachmodell und bei einer Transkription ohne Text schließt er sich direkt nach `completed`. Bei einem ungültigen Token schließt er mit dem Code 4001. Gibt es die Transkription nicht oder gehört sie Ihnen nicht, schließt er mit dem Code 4003.

**4. Ergebnis abrufen.** Solange die Transkription nicht fertig ist, beantwortet der Server diesen Aufruf mit dem Status 400:

```
curl -H "Authorization: Bearer tw_…" https://transcription.uni-osnabrueck.de/api/transcription/TRANSCRIPTION_ID
```

Die Antwort enthält die Äußerungen (`utterances`, jeweils mit `start` und `end` in Millisekunden, `text` und `speaker`), den gesamten Text (`text`), die Sprache (`language`) und die Namen der Sprechenden (`speaker_mappings`). Für eine fertige Datei hängen Sie stattdessen `/export/txt`, `/export/srt`, `/export/vtt` oder `/export/json` an die Adresse an.

## Grenzen

Dateien und Ergebnisse werden wie in der Weboberfläche nach {{retention_days}} Tagen automatisch gelöscht.

Voreinstellungen und Pakete wendet die Weboberfläche an. `/api/transcribe` kennt sie nicht, Sie senden die Einstellungen also selbst. Die Aufrufe für Voreinstellungen akzeptieren ebenfalls einen Token.
