# Verfeinerung

## Was die Verfeinerung macht

Bei der Verfeinerung geht ein Sprachmodell Ihr Transkript durch und korrigiert eindeutige Fehler. Es soll nur Folgendes ändern:

- Rechtschreib- und Zeichensetzungsfehler,
- offensichtliche Grammatikfehler, die Erkennungsfehler sind und nicht der Sprechweise entsprechen,
- uneinheitliche Fachbegriffe und Eigennamen,
- Füllgeräusche wie „äh“, „ähm“ oder „hm“,
- Fehlstarts und Selbstkorrekturen, bei denen die Person neu ansetzt.

Das Sprachmodell soll nichts umformulieren, gesprochene Sprache nicht in Schriftsprache umwandeln, Zeiten und die Angabe der sprechenden Person nicht verändern und genau so viele Äußerungen zurückgeben, wie es erhalten hat. Bei Unsicherheit soll es den Text lassen, wie er ist. Eine Übersetzung ist die Verfeinerung nicht, dafür gibt es den Abschnitt „Übersetzung“.

Das Original bleibt unverändert. Die Verfeinerung ist eine eigene Fassung, die Sie mit **Verfeinert** neben **Original** ansehen. Sie wird mit der Transkription gespeichert, ist beim erneuten Öffnen wieder da und wird zusammen mit ihr gelöscht.

> **Erst speichern.** Die Verfeinerung arbeitet mit dem gespeicherten Text. Änderungen im Editor, die Sie noch nicht mit **Änderungen speichern** gesichert haben, sind nicht enthalten.

## Wann sie sich lohnt

Die Verfeinerung betrifft nur die oben genannten Punkte. Sie lohnt sich deshalb vor allem, wenn Ihr Transkript viele davon enthält, zum Beispiel Füllgeräusche oder uneinheitlich geschriebene Fachbegriffe und Namen. Die Zusammenfassung der Änderungen zeigt Ihnen, was das Sprachmodell geändert hat.

## Verfeinern

Klicken Sie im Reiter **Untertitel** über der Tabelle auf **Mit LLM verfeinern**. Die Schaltfläche gibt es, solange noch keine Verfeinerung existiert. Es öffnet sich ein Dialog mit demselben Namen.

![Der Dialog „Mit LLM verfeinern“ mit eingetragenem Kontext; nummerierte Markierungen heben die Bedienelemente hervor](shots/refine.png)

1. **Voreinstellung wählen...** lädt eine Verfeinerungs-Voreinstellung und trägt ihren Kontext ein. **Als Voreinstellung speichern** fragt nach einem Namen (bestätigen Sie mit dem Häkchen oder der Eingabetaste) und speichert den aktuellen Kontext unter diesem Namen als Voreinstellung.
2. **Kontext (optional)**: Hinweise, die dem Sprachmodell bei Fachbegriffen und Eigennamen helfen, zum Beispiel „Informatik-Vorlesung, Vortragende Person ist Prof. Müller“.
3. **Verfeinern** startet die Verfeinerung. **Abbrechen** schließt den Dialog.

Das Sprachmodell erhält das Original mit den gespeicherten Kennungen wie `SPEAKER_00`, nicht mit den Namen aus **Namen der Sprechenden**. Die Namen setzt transkribierBAR erst bei der Anzeige von **Verfeinert** ein. Sie können sie also vor oder nach dem Verfeinern vergeben und ändern. Sind Namen für die Korrektur wichtig, tragen Sie sie unter **Kontext (optional)** ein.

Während der Verfeinerung steht auf der Schaltfläche **Transkription wird verfeinert...**, und das Kontextfeld und die Schaltflächen sind gesperrt. Bei mehr als 50 Äußerungen weist ein Hinweis darauf hin, dass die Verfeinerung mehrere Minuten dauern kann. Die Seite wartet auf das Sprachmodell. Bleiben Sie darauf, bis der Dialog sich schließt. Verlassen Sie die Seite trotzdem, läuft die Verfeinerung auf dem Server weiter. Sie sehen sie, wenn Sie die Transkription später erneut öffnen. Ein neuer Versuch, bevor sie fertig ist, schlägt fehl. Danach zeigt der Editor die Ansicht **Verfeinert**.

Schlägt es fehl, steht im Dialog **Verfeinerung fehlgeschlagen. Bitte versuchen Sie es erneut.** Versuchen Sie es dann erneut.

## Die verfeinerte Ansicht lesen

In der Ansicht **Verfeinert** fasst eine Leiste über der Tabelle die Änderungen zusammen, und geänderte Zeilen sind markiert.

![Die Ansicht „Verfeinert“ mit der Zusammenfassung der Änderungen und einer geänderten Zeile im Vergleich mit dem Original; nummerierte Markierungen heben die Bedienelemente hervor](shots/refined.png)

1. **Verfeinert** wechselt in die verfeinerte Ansicht, **Original** zurück zum Original.
2. Die **Zusammenfassung der Änderungen**, mit der Zahl der geänderten Äußerungen. Ein Klick darauf klappt sie auf oder zu. Aufgeklappt beschreibt sie in Worten, was das Sprachmodell geändert hat, und nennt den **Kontext**, falls Sie einen angegeben haben.
3. Eine geänderte Zeile: Sie hat einen bernsteinfarbenen Strich am linken Rand und auf größeren Bildschirmen einen Punkt neben der Zeilennummer. Ein Klick auf den Punkt zeigt **Original** und **Verfeinert** nebeneinander (nur auf größeren Bildschirmen), wie hier unter der ersten Zeile.

Die Ansicht ist schreibgeschützt. Wollen Sie Text selbst ändern, tun Sie das im Original.

## Wenn Abschnitte nicht verfeinert werden konnten

transkribierBAR schickt die Äußerungen abschnittsweise an das Sprachmodell. Scheitert ein Abschnitt auch nach mehreren automatischen Versuchen, werden die übrigen trotzdem verfeinert und gespeichert. Die gescheiterten Abschnitte behalten ihren Originaltext. Scheitern alle, entsteht keine Verfeinerung, und Sie sehen die Fehlermeldung.

Die betroffenen Zeilen haben einen gestrichelten grauen Rand und auf größeren Bildschirmen einen hohlen grauen Punkt. In der Leiste steht außerdem zum Beispiel **Nicht verfeinert (Originaltext beibehalten): Äußerungen 451–500**. Mit **Fehlgeschlagene Abschnitte erneut verfeinern** wiederholen Sie nur diese Abschnitte, während die Schaltfläche **Wird wiederholt…** zeigt. Dabei gilt der gespeicherte Kontext. Was schon gelungen ist, wird nicht erneut gesendet. Scheitert ein Abschnitt wieder, bleibt er in der Liste.

Zwei Meldungen können dort erscheinen: **Wiederholung fehlgeschlagen. Bitte versuchen Sie es erneut.** und **Seit dem Speichern dieser Verfeinerung wurden Äußerungen hinzugefügt oder entfernt. Löschen Sie die Verfeinerung und verfeinern Sie erneut.**

## Wenn Sie das Original ändern

Die Verfeinerung passt sich nicht an. Ändern Sie nach dem Verfeinern Text im Original und speichern, erscheint in der Werkzeugleiste in Bernstein **Original wurde bearbeitet – löschen und erneut verfeinern**. Die Ansicht **Verfeinert** zeigt bis dahin den älteren Text. Änderungen an Zeiten oder Namen zählen dabei nicht.

Mit **Verfeinerung löschen** entfernen Sie die Verfeinerung nach einer Rückfrage. Das Original bleibt unverändert. Danach können Sie neu verfeinern. Analysen und Übersetzungen, die aus der gelöschten Verfeinerung entstanden sind, zeigen **Quelle nicht mehr verfügbar**, eine Analyse sofort, eine Übersetzung sobald Sie die Transkription erneut öffnen.

## Zusammenspiel mit anderen Schritten

Analyse und Übersetzung bieten die Verfeinerung als **Quelle** an und wählen sie von sich aus, sobald es eine gibt. Sie können dort auf **Original** wechseln.

In einem Paket mit Verfeinerungs-Voreinstellung verfeinert der Browser nach der Transkription automatisch, mit dem Kontext der Voreinstellung. Danach folgen Analyse und Übersetzung. Bleiben Sie auf der Seite, bis alle Schritte fertig sind.
