/* Exports.
   Script classique : partage la portée globale avec les autres fichiers de js/ (ordre de chargement : voir index.html). */
"use strict";
/* ---------- Exports ---------- */

const ENTETE_EXPORT = ["Groupe", "Étudiant", "Statut", "Titre", "Date de parution", "Auteur", "Qualité de l’auteur", "Nationalité", "Type d’article", "Mots-clés", "Keywords (EN)", "Concepts en sciences infirmières", "Objet / sujet principal", "Opinion de l’auteur", "Controverse", "Libre", "Référence APA", "Date de saisie", "Lien"];
const lignesExport = () => filtered().map(i => [i.groupe, i.etudiant, stInfo(i.statut).long, i.titre, fmtD(i.parution), i.auteur, i.qualite, i.nation, i.type, i.mots, i.kw, i.concepts, i.objet, i.opinion, i.controverse, i.libre, LydiaApa.apa(i).text, fmtD(i.ajoute), urlSure(i.lien)].map(v => v || ""));

function exportXlsx() {
  if (typeof XLSX === "undefined") { alert("Module Excel non chargé."); return; }
  const ws = XLSX.utils.aoa_to_sheet([ENTETE_EXPORT, ...lignesExport()]);
  ws["!cols"] = [18, 12, 16, 40, 14, 24, 20, 14, 22, 28, 28, 36, 36, 36, 30, 24, 50, 14, 40].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lectures");
  XLSX.writeFile(wb, "lectures-memoire-" + stamp() + ".xlsx");
}

// CSV lisible par Excel en français : séparateur « ; », guillemets doublés, BOM UTF-8.
// Une cellule qui commence par = + - @ est préfixée d'une apostrophe pour ne pas être interprétée comme une formule.
const celluleCsv = v => { let t = String(v == null ? "" : v).replace(/\r?\n/g, " "); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
const versCsv = (entete, lignes) => [entete, ...lignes].map(l => l.map(celluleCsv).join(";")).join("\r\n");
function exportCsv() {
  telecharger(new Blob(["\ufeff" + versCsv(ENTETE_EXPORT, lignesExport())], { type: "text/csv;charset=utf-8" }), "lectures-memoire-" + stamp() + ".csv");
}

// Une fiche de lecture seule, en PDF portrait : à joindre à un dossier ou à imprimer.
function exportFichePdf(id) {
  const i = itemsAll.find(x => x.id === id);
  if (!i) return;
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const larg = 180; let y = 16;
  const bloc = (titre, texte, gras) => {
    const lignes = doc.splitTextToSize(String(texte || "—"), larg);
    if (y + 6 + lignes.length * 5 > 285) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(titre, 15, y); y += 5;
    doc.setFont("helvetica", gras ? "bold" : "normal"); doc.text(lignes, 15, y); y += lignes.length * 5 + 3;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  const t = doc.splitTextToSize(i.titre || "Sans titre", larg); doc.text(t, 15, y); y += t.length * 6 + 1;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("Fiche de " + i.etudiant + " (" + stInfo(i.statut).lib.toLowerCase() + ") · " + (i.groupe || "") + " · saisie le " + fmtD(i.ajoute), 15, y); y += 7;
  doc.setFontSize(10);
  bloc("Référence APA", LydiaApa.apa(i).text);
  bloc("Article", ["Parution : " + (fmtD(i.parution) || "-"), "Auteur : " + (i.auteur || "-") + " (" + (i.qualite || "-") + ")", "Nationalité : " + (i.nation || "-"), "Type : " + (i.type || "-")].join("\n"));
  [["Mots-clés", i.mots], ["Keywords", i.kw], ["Concepts en sciences infirmières", i.concepts], ["Objet / sujet principal", i.objet], ["Opinion de l’auteur", i.opinion], ["Controverse", i.controverse], ["Libre", i.libre]].forEach(([k, v]) => bloc(k, v));
  doc.save("fiche-" + (cleTitre(i.titre).replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "lecture") + "-" + stamp() + ".pdf");
}

// Mes notes personnelles, en texte brut : tout ce qui est affiché ici n'est lisible que de l'utilisateur.
function notesEnTexte() {
  return N.notes.slice().sort((a, b) => (b.epingle ? 1 : 0) - (a.epingle ? 1 : 0) || String(b.date).localeCompare(String(a.date))).map(n => {
    const liens = n.liens.map(id => ficheLiee(id)).filter(Boolean).map(f => "  - " + f.titre + " (" + f.etudiant + ")");
    return [(n.epingle ? "[épinglée] " : "") + n.titre, fmtD(n.date) + ((n.etiquettes || []).length ? " · " + n.etiquettes.map(t => "#" + t).join(" ") : ""), "", n.texte, liens.length ? "\nFiches liées :\n" + liens.join("\n") : ""].join("\n").trim();
  }).join("\n\n----------------------------------------\n\n");
}
function exportNotes() {
  if (!N.notes.length) return;
  telecharger(new Blob(["\ufeff" + notesEnTexte()], { type: "text/plain;charset=utf-8" }), "mes-notes-" + stamp() + ".txt");
}

function exportPdf() {
  if (!window.jspdf) { alert("Module PDF non chargé."); return; }
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(13); doc.text("Lectures du mémoire - IFSI", 10, 10);
  doc.setFontSize(8); doc.text("Export du " + fmtD(new Date().toISOString()), 10, 15);
  const l = filtered();
  const body = l.map(i => [i.etudiant + "\n" + ("(" + stInfo(i.statut).lib.toLowerCase() + ")"),
    (i.titre || "") + "\nParution : " + (fmtD(i.parution) || "-") + "\nAuteur : " + (i.auteur || "-") + " (" + (i.qualite || "-") + ")\nNationalité : " + (i.nation || "-") + "\nType : " + (i.type || "-") + "\nSaisi le " + fmtD(i.ajoute) + (urlSure(i.lien) ? "\nLien : " + urlSure(i.lien) : ""),
    i.mots || "", i.kw || "", i.concepts || "", i.objet || "", i.opinion || "", i.controverse || "", i.libre || "", LydiaApa.apa(i).text]);
  doc.autoTable({
    startY: 18,
    head: [["Étudiant", "1 - Article", "2 - Mots-clés", "3 - Keywords", "4 - Concepts", "5 - Objet / sujet", "6 - Opinion", "7 - Controverse", "8 - Libre", "9 - Référence APA"]],
    body,
    styles: { fontSize: 6.5, cellPadding: 1.5, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [47, 95, 208] },
    columnStyles: { 0: { cellWidth: 20, textColor: 255, fontStyle: "bold" }, 1: { cellWidth: 50 } },
    didParseCell: d => { if (d.section === "body" && d.column.index === 0) d.cell.styles.fillColor = l[d.row.index].couleur || "#888888"; }
  });
  doc.save("lectures-memoire-" + stamp() + ".pdf");
}
