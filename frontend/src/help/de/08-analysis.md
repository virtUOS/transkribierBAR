# Analyse

## Was die Analyse macht

Die Analyse lässt ein Sprachmodell Ihr Transkript auswerten, zum Beispiel als Zusammenfassung mit Kapiteln, als Sitzungsprotokoll oder nach einer eigenen Anweisung. Das Transkript selbst bleibt dabei unverändert. Jedes Ergebnis wird als eigener Eintrag zur Transkription gespeichert und zusammen mit ihr gelöscht.

Sie finden die Analyse im Reiter **Analyse** der Detailansicht, neben **Untertitel**. Das Sprachmodell erhält den Text der Äußerungen mit Startzeit und sprechender Person. Dabei setzt transkribierBAR die Namen ein, die Sie unter **Namen der Sprechenden** vergeben haben, und zwar zum Zeitpunkt der Erstellung.

> **Erst speichern.** Die Analyse arbeitet mit dem gespeicherten Text. Änderungen im Editor, die Sie noch nicht mit **Änderungen speichern** gesichert haben, sind nicht enthalten.

## Analyse erstellen

Wählen Sie eine Vorlage und klicken Sie auf **Generieren**.

![Das Analyse-Formular mit eingeblendetem Prompt; nummerierte Markierungen heben die Bedienelemente hervor](shots/analysis-form.png)

1. **Vorlage auswählen** bietet die Vorlagen an (siehe „Vorlagen“). Voreingestellt ist **Zusammenfassung mit Kapiteln**.
2. **Kapitel definieren (optional)** erscheint bei **Zusammenfassung mit Kapiteln** (siehe „Kapitel vorgeben und Agenda“).
3. **Prompt anpassen** zeigt die Anweisung der Vorlage an das Sprachmodell (siehe „Prompt anpassen“).
4. **Ausgabesprache** legt die Sprache des Ergebnisses fest. Sie ist mit der erkannten Sprache der Transkription vorbelegt.
5. **Quelle** erscheint, wenn es eine Verfeinerung gibt (siehe „Quelle: Original oder Verfeinert“).
6. **Generieren** startet die Analyse.

Während die Analyse läuft, zeigt die Seite zum Beispiel **Zusammenfassung mit Kapiteln wird erstellt...** und blendet das Formular aus. Die Seite wartet auf die Antwort des Sprachmodells. Bleiben Sie darauf, bis das Ergebnis erscheint. Verlassen Sie die Seite trotzdem, läuft die Analyse auf dem Server weiter. Das Ergebnis sehen Sie, wenn Sie die Transkription später erneut öffnen. Ein neuer Versuch, bevor sie fertig ist, schlägt fehl.

Sie können beliebig viele Analysen erstellen, auch mit verschiedenen Vorlagen. Jede steht als eigener Eintrag in der Liste. Mit **+ Neue Analyse** öffnen Sie das Formular erneut, **Abbrechen** schließt es. Gibt es noch keine Analyse, ist das Formular sofort sichtbar.

## Vorlagen

- **Zusammenfassung mit Kapiteln:** eine Gesamtzusammenfassung und Kapitel mit Titel, Zeitspanne und Kurzbeschreibung.
- **Sitzungsprotokoll:** Titel, Teilnehmende, Kernpunkte, Entscheidungen und Aufgaben mit zuständiger Person.
- **Agendabasierte Notizen:** Notizen entlang einer Tagesordnung. Das Ergebnis erscheint wie bei der Zusammenfassung als Text mit Kapiteln.
- **Eigene Anweisung:** Sie schreiben die Anweisung selbst (siehe „Prompt anpassen“).

## Kapitel vorgeben und Agenda

Bei **Zusammenfassung mit Kapiteln** gibt es die Aufklappliste **Kapitel definieren (optional)**. Mit **Kapitel hinzufügen** legen Sie je Kapitel eine Zeile an, mit einem **Kapiteltitel** und einer **Kurzen Beschreibung**. Es genügt eines von beiden. Ganz leere Zeilen werden ignoriert, **Entfernen** löscht eine Zeile. Sie können bis zu 30 Kapitel vorgeben. Das Sprachmodell richtet die Gliederung danach aus. Kommt ein Thema in der Aufnahme nicht vor, soll das Kapitel trotzdem im Ergebnis stehen, mit einem Hinweis in der Beschreibung und mit **—** statt einer Zeitspanne.

Bei **Agendabasierte Notizen** erscheint das Feld **Agenda**. Fügen Sie dort Ihre Tagesordnung ein. Lassen Sie es leer, leitet das Sprachmodell die Punkte aus dem Transkript ab.

## Prompt anpassen

Unter **Prompt anpassen** sehen Sie die Anweisung der gewählten Vorlage. Sie ist auf Englisch und enthält Platzhalter in geschweiften Klammern, die transkribierBAR sonst selbst ausfüllt. **Auf Vorlage zurücksetzen** stellt den Originaltext wieder her. Bei **Eigene Anweisung** ist das Feld zunächst leer.

> **Geänderter Prompt.** Sobald Sie den Text ändern oder **Eigene Anweisung** verwenden, wird er so gesendet, wie er dasteht. Platzhalter werden dann nicht mehr ersetzt, und **Kapitel definieren** und **Agenda** werden nicht mitgeschickt. Die **Ausgabesprache** gilt weiterhin.

Das Sprachmodell antwortet immer mit einem strukturierten Text (JSON). Ergebnisse, die wie eine Zusammenfassung oder ein Protokoll aufgebaut sind, zeigt die Seite als Karten. Alle anderen erscheinen als Text.

## Quelle: Original oder Verfeinert

Gibt es eine Verfeinerung, erscheint im Formular der Umschalter **Quelle** mit **Original** und **Verfeinert**. Voreingestellt ist **Verfeinert**. Ohne Verfeinerung gibt es den Umschalter nicht, und die Analyse nutzt das Original. Eine Übersetzung kann nicht als Quelle dienen.

Unter dem Ergebnis steht, woraus es entstanden ist: **aus Verfeinerung** oder **aus Original**. Hat sich der Text dieser Quelle seither geändert, erscheint die Angabe in Bernstein mit dem Zusatz **Quelle hat neueren Inhalt**. Wurde die Verfeinerung gelöscht, steht dort **Quelle nicht mehr verfügbar**. Änderungen an Zeiten oder Namen zählen nicht als neuer Inhalt. Eine bestehende Analyse aktualisiert sich nicht von selbst. Erstellen Sie bei Bedarf eine neue.

## Ergebnisse lesen und weiterverwenden

Ein Klick auf einen Eintrag klappt ihn auf.

![Eine aufgeklappte Zusammenfassung mit Kapiteln; nummerierte Markierungen heben die Bedienelemente hervor](shots/analysis-result.png)

1. Der Name der Vorlage (oder **Eigene Anweisung**). Danach steht das Datum, und das verwendete Sprachmodell steht am rechten Ende der Kopfzeile.
2. Das Papierkorbsymbol (**Löschen**) löscht den Eintrag nach einer Rückfrage.
3. **Ergebnis kopieren** legt den Text in die Zwischenablage. **TXT** und **Markdown** laden ihn herunter, als Datei mit dem Namen der Aufnahme und dem Zusatz `_analysis`. Die Schaltflächen stehen über und unter dem Ergebnis.
4. Bei Kapiteln, Kernpunkten, Entscheidungen und Aufgaben springt der Player nach einem Klick auf die Zeitangabe an diese Stelle.

Das Kreuz, das beim Darüberfahren an einer Karte erscheint, entfernt diesen Punkt nach einer Rückfrage aus dem Ergebnis. Nach der Bestätigung wird das sofort gespeichert und lässt sich nicht rückgängig machen. Bei der Zusammenfassung gilt das für Kapitel, nicht für den Zusammenfassungstext.

Unter dem Ergebnis steht noch einmal, womit es erstellt wurde.

## Wenn die Analyse nicht klappt

Nach einem Fehler entsteht kein Eintrag, Sie können es erneut versuchen. Die Meldung erscheint unter **Generieren**. Zwei Fälle haben eigene Texte:

- **Die Analyse hat das Ausgabelimit des Sprachmodells erreicht, bevor sie vollständig war. Versuchen Sie einen gezielteren Prompt.** Dieselbe Anfrage führt wieder dorthin. Verkürzen oder präzisieren Sie die Anweisung.
- **Das Sprachmodell hat eine fehlerhafte Antwort zurückgegeben. Bitte versuchen Sie es erneut.** transkribierBAR hat es vorher mehrmals selbst versucht. Ein neuer Versuch kann gelingen.

## In einem Paket

Enthält ein Paket eine Analyse-Voreinstellung, erstellt der Browser die Analyse nach der Transkription und der Verfeinerung automatisch. Gibt es dann eine Verfeinerung, nutzt sie diese, sonst das Original. Im Formular lädt das Feld **Analyse** eine Voreinstellung. **Als Voreinstellung speichern** sichert die aktuellen Angaben. Mehr dazu steht im Abschnitt „Voreinstellungen“.
