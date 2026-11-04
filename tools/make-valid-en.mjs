/* Build assets/words-l4.js - the wide "accepted rung" bank for Trace.
   Answers and ladders always come from the curated WORDS_EN
   (assets/words-en.js); this bank only decides what a player is
   allowed to type as a rung.

   The recipe, end to end:
   - take the four-letter words that are both dictionary-registered
     (the dwyl list via jonathanwelton/word-lists, 4-letter-words.json)
     and in common use (hermitdave/FrequencyWords, the 2018 en_50k list)
   - subtract the frozen HAND list below: US first names, profanity and
     slurs, proper nouns, brands, initialisms, contraction fragments.
     The list is frozen on purpose, so the bank rebuilds without the
     name file that shaped it and a rebuild can never silently drift
   - add every curated WORDS_EN four-letter word, so no answer or
     ladder word ever stops being typeable
   - sort, uppercase, one comma-separated line

   Run from the repo root:
     node tools/make-valid-en.mjs           verify the committed bank
     node tools/make-valid-en.mjs --write   rebuild it from the sources

   Sources (download once, next to the repo root):
     curl -LO https://raw.githubusercontent.com/jonathanwelton/word-lists/main/4-letter-words.json
     curl -LO https://raw.githubusercontent.com/hermitdave/FrequencyWords/main/content/2018/en/en_50k.txt

   Zero dependencies - plain Node (fs/path/url only). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_SRC = process.argv[2] || path.join(ROOT, '4-letter-words.json');
const FREQ_SRC = process.argv[3] || path.join(ROOT, 'en_50k.txt');
const WORDS_EN_PATH = path.join(ROOT, 'assets', 'words-en.js');
const OUT = path.join(ROOT, 'assets', 'words-l4.js');
const WRITE = process.argv.includes('--write');

/* the frozen hand list (738 words): every word cut from the
   dictionary-registered, in-common-use pool when the bank was curated */
const HAND = new Set("AARU,ABBY,ABEL,ACLU,ADAM,ADDY,ADEN,AGOS,AGRA,AGUA,AHAB,AINT,AJAX,ALAN,ALBA,ALEC,ALEX,ALGY,ALIA,ALLE,ALLO,ALLS,ALMA,AMAL,AMAR,AMIT,AMMA,AMMU,AMOR,AMOS,ANDA,ANDI,ANDY,ANNA,ANNE,ANNI,ARAB,AREN,ARES,ARGO,ARNE,ARSE,ARYA,ASAP,ASHA,ASIA,ASTA,BABI,BABS,BAIN,BAJA,BAKU,BALA,BALI,BALU,BANA,BARA,BARI,BARR,BART,BEAL,BEIN,BELA,BENI,BERN,BERT,BESS,BETH,BIBI,BLAM,BOCA,BOER,BOGO,BOIS,BOKO,BONA,BONG,BONO,BOOB,BORG,BOSE,BOYD,BOYO,BRAM,BREE,BREN,BRET,BUBS,BUDA,BURK,BURT,BUTS,CACA,CADE,CADY,CAIN,CANA,CANN,CAPA,CARA,CARL,CARO,CARR,CARY,CASA,CASS,CATE,CATH,CERN,CHAM,CHAN,CHAO,CHEE,CHEM,CHEN,CHER,CHET,CHIL,CHOL,CHON,CHUN,CLIO,CLIT,CMDR,COBB,COCK,COLE,COLI,COMM,COMP,CONG,COON,CORA,CORP,CORT,CORY,CRAP,CRAY,CREE,CRIS,CUNT,DADE,DAGO,DALI,DAMN,DANA,DANE,DANI,DAVE,DAVY,DEJA,DERE,DEUS,DEUX,DIAN,DIAS,DICH,DICK,DIDN,DIKE,DION,DODD,DONA,DONG,DONT,DOON,DORA,DORI,DORN,DOUG,DOWD,DREW,DUAN,DUCE,DUMA,DYKE,EBEN,ECON,EDEN,EDNA,ELIA,ELLA,ELLE,ELON,ELSA,EMIL,EMMA,EMMY,ENID,ENOS,ERIC,ERIE,ERIK,ERIN,EROS,ETON,ETTA,EVAL,EVAN,EYRE,EZRA,FAGS,FAIT,FALK,FART,FIDE,FIDO,FINI,FISK,FITZ,FLOR,FRED,FRIG,FUCK,FUJI,GABE,GABI,GABY,GAEL,GAIL,GALT,GANT,GARE,GARY,GAUL,GEET,GEIR,GENA,GERE,GIGI,GILA,GOBI,GOFF,GOGO,GOLI,GONA,GOOK,GORA,GOSS,GOTO,GREG,GUGU,GUMP,GUNA,GUNG,GWEN,HANS,HARV,HASN,HEER,HEHE,HEIL,HEIN,HELL,HENG,HERA,HERR,HIRO,HOES,HOMO,HONG,HOSS,HOWE,HUCK,HUEY,HUGH,HUGO,HUME,HUNH,HWAN,HYDE,IAGO,ILYA,IMAN,INCA,INDY,INEZ,INGA,IOWA,IRAN,IRAQ,IRMA,ISIS,ISNT,IVAN,IZZY,JAIN,JAKE,JAMI,JANE,JEAN,JEFE,JEFF,JEON,JESS,JESU,JIAO,JILL,JOAN,JOBE,JOEL,JOHN,JOIE,JONG,JONI,JOON,JOSE,JOUR,JOVE,JUAN,JUDE,JUDY,JUGS,JUHA,JULE,JULY,JUNE,JURA,JURI,KAKA,KALA,KALI,KAMI,KANE,KANG,KANT,KARI,KARL,KATE,KATH,KATY,KENT,KIEV,KIKE,KIKI,KIKU,KIRK,KLAN,KNOX,KNUT,KOCH,KODA,KOKO,KONG,KORA,KRIS,KUAN,KUBA,KUEI,KUKI,KUNG,KURT,KWAN,KYLE,LADY,LAIT,LALO,LANA,LANG,LAOS,LARS,LATA,LEAH,LEAR,LEDA,LEIF,LENA,LENG,LEON,LETO,LETS,LEVI,LIDA,LILA,LILL,LIMA,LINA,LIND,LINN,LISA,LISE,LIZA,LOIS,LOKI,LOLA,LOLO,LORA,LORI,LOUP,LOWE,LUCE,LUCY,LUIS,LUKE,LULA,LULU,LUPE,LYNN,LYON,LYRA,MACK,MADI,MADO,MADS,MAGA,MAHA,MAIA,MAJA,MALI,MALO,MAMO,MANA,MANG,MANI,MANN,MARA,MARC,MARG,MARI,MARU,MARX,MARY,MATT,MAUD,MAYA,MAYS,MECH,MEER,MEIN,MERV,META,MICK,MIGS,MIKI,MILA,MILO,MIMA,MIMI,MINA,MING,MINO,MINS,MIRA,MIRI,MIRO,MMMM,MODI,MOGO,MONA,MONG,MONT,MORA,MORG,MORO,MORT,MOSE,MOTT,MOYA,MYRA,NADA,NAGA,NAPA,NASA,NASH,NATE,NATO,NAZI,NEAL,NEIL,NEIN,NELL,NEMO,NGAI,NIKE,NILE,NILS,NINA,NING,NOAH,NOAM,NOMA,NONA,NONG,NORA,NOVA,NUDE,NYET,ODIN,ODUM,OFFS,OHIO,OLAF,OLDS,OLEG,OLGA,OLOF,OMAN,OMAR,OMER,OOOO,ORGY,ORLY,OSLO,OTIS,OTTO,OWEN,PACO,PALI,PANI,PARI,PARR,PASO,PAUL,PELE,PELL,PERE,PETE,PETR,PHIL,PIET,PIMP,PINA,PINO,PISA,PISS,PIUS,POLK,PONT,POOF,POON,PORN,PREM,PRES,PROB,PRUE,PUGH,PUSS,QUAI,QUAN,QUOT,RACH,RADA,RAFE,RAFF,RAMA,RAMI,RANA,RANE,RAPE,RAUL,RAVI,RAYA,REES,REID,REMI,RENO,RENU,REVE,RICK,RIGA,RITA,RITZ,RIVA,ROLF,ROME,RONG,ROOP,RORY,ROSA,ROSS,ROXY,RUDY,RUKH,RUPA,RUSS,RUTH,SAAD,SABA,SABE,SADE,SADO,SALA,SANT,SARA,SASA,SAUL,SCOT,SEAN,SENA,SERB,SETH,SEVE,SEXY,SHAN,SHAT,SHAY,SHEA,SHEL,SHEN,SHER,SHES,SHIA,SHIH,SHIK,SHIT,SHRI,SIAM,SIKH,SIMA,SIND,SION,SITA,SITH,SITU,SIVA,SKYE,SLUT,SOCO,SOHO,SOIR,SOOK,SORY,SPIC,STAN,STEN,STYX,SUEY,SUEZ,SULU,SUMI,SUNE,SUNG,SUSI,SUSU,SUZY,TAFT,TAKA,TAKU,TALI,TAMA,TANA,TANE,TANO,TARA,TARR,TASH,TATE,TENG,TERI,TESS,THAD,THAI,THEA,THEO,THRU,TIEN,TIMO,TINA,TING,TINO,TITI,TITS,TOBE,TOBY,TODA,TODD,TOGO,TOHO,TOMA,TONY,TOPO,TORA,TORI,TORU,TOTO,TOYO,TRAN,TRAV,TRES,TRIX,TRON,TROY,TUAN,TULA,TURD,TURK,TUSH,TUTS,TWAT,TYNE,ULLA,URDU,URSA,USSR,UTAH,VAIL,VALI,VASA,VASU,VAYU,VEDA,VEGA,VENA,VERA,VERN,VICK,VILA,VITA,VITE,VIVE,WACO,WALT,WANG,WANK,WASN,WAWA,WEET,WEVE,WILK,WONG,WOON,WRAY,WYNN,XIII,YALE,YANA,YMCA,YORK,YOUD,YOUS,YUKI,YUMA,ZACH,ZACK,ZEKE,ZEUS,ZION,ZULU".split(','));

const HEADER = "/* words-l4.js - the wide four-letter bank for typed rungs. %d words,\n   uppercase, alphabetical, comma-separated, so the page parses it the\n   same way it parses words-en.js. Loaded once via <script src> next to\n   the curated bank.\n   Two banks, two jobs. Answers and ladders still come from the curated\n   WORDS_EN (assets/words-en.js): the daily ladder, its start, its target\n   and its par are exactly what they always were. This bank only decides\n   what a player is allowed to type as a rung, so a real word in common\n   use is never bounced for being unfashionable.\n   Recipe (tools/make-valid-en.mjs rebuilds this file byte for byte):\n   - four-letter words that are both dictionary-registered (the dwyl\n     list via jonathanwelton/word-lists, 4-letter-words.json) and in\n     common use (hermitdave/FrequencyWords, the 2018 en_50k list)\n   - minus a frozen hand list: US first names, profanity and slurs,\n     proper nouns, brands, initialisms, contraction fragments (the\n     list lives in the tool, so the bank rebuilds without the name\n     file that shaped it)\n   - plus every curated WORDS_EN four-letter word, so no answer or\n     ladder word ever stops being typeable\n   FrequencyWords is MIT-licensed, and its notice belongs here:\n   Copyright (c) 2016 Hermit Dave\n   Permission is hereby granted, free of charge, to any person obtaining a copy\n   of this software and associated documentation files (the \"Software\"), to deal\n   in the Software without restriction, including without limitation the rights\n   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n   copies of the Software, and to permit persons to whom the Software is\n   furnished to do so, subject to the following conditions:\n   The above copyright notice and this permission notice shall be included in all\n   copies or substantial portions of the Software.\n   THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\n   THE SOFTWARE.\n   No game logic here - just data. */\n";

/* the curated four-letter words: answers and ladders, never hand-cut */
function curatedFour(){
  const src = fs.readFileSync(WORDS_EN_PATH, 'utf8');
  const m = src.match(/const WORDS_EN = "([^"]+)"$/m);
  if (!m) throw new Error('could not read WORDS_EN from assets/words-en.js');
  return m[1].split(',').filter(w => w.length === 4);
}

function build(){
  if (!fs.existsSync(DICT_SRC)) throw new Error('missing source ' + DICT_SRC + ' - see the header for the curl lines');
  if (!fs.existsSync(FREQ_SRC)) throw new Error('missing source ' + FREQ_SRC + ' - see the header for the curl lines');
  const dict = new Set(JSON.parse(fs.readFileSync(DICT_SRC, 'utf8'))
    .map(w => String(w).toUpperCase())
    .filter(w => /^[A-Z]{4}$/.test(w)));
  const common = new Set(fs.readFileSync(FREQ_SRC, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map(w => w.toUpperCase()));
  const pool = [...dict].filter(w => common.has(w) && !HAND.has(w));
  return [...new Set([...pool, ...curatedFour()])].sort();
}

function render(words){
  return HEADER.replace('%d', String(words.length)) +
    'const WORDS_L4 = "' + words.join(',') + '";\n';
}

/* without sources: shape, cleanliness and no-regression checks on the
   committed bank; with sources: the bank must equal a rebuild */
function verify(){
  const list = fs.readFileSync(OUT, 'utf8').match(/const WORDS_L4 = "([^"]*)"/);
  if (!list) throw new Error(OUT + ': WORDS_L4 string not found');
  const bank = list[1].split(',');
  if (bank.some(w => !/^[A-Z]{4}$/.test(w))) throw new Error('entries must be uppercase A-Z, exactly 4 letters');
  if (new Set(bank).size !== bank.length) throw new Error('duplicate entries');
  if (bank.some((w, i) => i > 0 && bank[i - 1] > w)) throw new Error('entries must be alphabetical');
  const curated = new Set(curatedFour());
  const gone = [...curated].filter(w => !bank.includes(w));
  if (gone.length) throw new Error('lost curated words (e.g. ' + gone[0] + ')');
  if (bank.length < 2000) throw new Error('suspiciously narrow bank (' + bank.length + ' words)');
  console.log('ok  assets/words-l4.js: ' + bank.length + ' words, alphabetical, keeps every curated four-letter word');
}

if (WRITE){
  const words = build();
  fs.writeFileSync(OUT, render(words));
  console.log('wrote ' + OUT + ': ' + words.length + ' words (' + fs.statSync(OUT).size + ' bytes)');
  verify();
} else if (fs.existsSync(DICT_SRC) && fs.existsSync(FREQ_SRC)){
  if (render(build()) !== fs.readFileSync(OUT, 'utf8'))
    throw new Error('the committed bank does not match a rebuild - run with --write to refresh it');
  console.log('ok  assets/words-l4.js matches a rebuild from the sources');
} else {
  verify();
}
