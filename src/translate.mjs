// GIPHY finds almost nothing for Italian queries ("gatto che applaude": 0 results, "cat applause": 6,
// measured). Reaction searches use a small vocabulary, so a dictionary does it: instant, free, offline.
const IT = {
  // feelings and reactions
  bravo: "well done", brava: "well done", bravi: "well done", complimenti: "congratulations", congratulazioni: "congratulations",
  grazie: "thank you", prego: "you're welcome", ciao: "hello", salve: "hello", buongiorno: "good morning", buonanotte: "good night",
  arrivederci: "bye", addio: "goodbye", evviva: "hooray", urrà: "hooray", vittoria: "victory", vinto: "win", vincere: "win",
  festa: "party", festeggiare: "celebrate", festeggia: "celebrate", auguri: "happy birthday", compleanno: "birthday",
  applauso: "applause", applausi: "applause", applaude: "applause", applaudire: "applause",
  ridere: "laugh", ride: "laugh", risata: "laughing", divertente: "funny", piangere: "cry", piange: "cry", triste: "sad",
  felice: "happy", contento: "happy", contenta: "happy", gioia: "joy", amore: "love", cuore: "heart", bacio: "kiss", abbraccio: "hug",
  arrabbiato: "angry", arrabbiata: "angry", rabbia: "rage", furioso: "furious", paura: "scared", spaventato: "scared",
  stanco: "tired", stanca: "tired", sonno: "sleepy", dormire: "sleep", noia: "bored", annoiato: "bored",
  confuso: "confused", confusa: "confused", boh: "shrug", sorpreso: "surprised", sorpresa: "surprise", scioccato: "shocked",
  pazzesco: "mind blown", incredibile: "amazing", fantastico: "awesome", grande: "awesome", grandissimo: "awesome", top: "awesome",
  perfetto: "perfect", ottimo: "great", bene: "good", male: "bad", sì: "yes", si: "yes", no: "no", forse: "maybe", ok: "ok", va: "ok",
  andiamo: "lets go", forza: "lets go", dai: "come on", aiuto: "help", scusa: "sorry", scusate: "sorry", oops: "oops", ops: "oops",
  aspetta: "wait", attesa: "waiting", pensare: "thinking", penso: "thinking", hmm: "thinking", fatto: "done", finito: "done",
  lavoro: "work", lavorare: "working", ufficio: "office", riunione: "meeting", caffè: "coffee", caffe: "coffee", pausa: "break",
  mattina: "morning", sera: "evening", notte: "night", oggi: "today", domani: "tomorrow", finalmente: "finally",
  lunedì: "monday", lunedi: "monday", venerdì: "friday", venerdi: "friday", weekend: "weekend", vacanza: "vacation", ferie: "vacation",
  successo: "success", fallimento: "fail", errore: "error", bug: "bug", disastro: "disaster", fuoco: "fire", panico: "panic",
  ballare: "dance", balla: "dance", ballo: "dance", correre: "running", corre: "running", saltare: "jump", salta: "jump",
  // animals and things
  gatto: "cat", gatti: "cats", gattino: "kitten", cane: "dog", cani: "dogs", cagnolino: "puppy", cucciolo: "puppy",
  scimmia: "monkey", panda: "panda", orso: "bear", coniglio: "bunny", anatra: "duck", pinguino: "penguin",
  bambino: "kid", bambina: "kid", nonna: "grandma", nonno: "grandpa", razzo: "rocket", fulmine: "lightning", pizza: "pizza",
};
const SKIP = new Set(["che", "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per", "e", "ed", "mi", "ti", "ci"]);

// Italian words become English; words it does not know pass through unchanged (names, English words).
export function toEnglish(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = words.filter((w) => !SKIP.has(w)).map((w) => IT[w] ?? w);
  return [...new Set(out)].join(" ") || query;
}
