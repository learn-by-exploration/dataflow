'use strict';

const crypto = require('crypto');

const WORDS = [
  'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse',
  'access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act',
  'action','actor','actress','actual','adapt','add','addict','address','adjust','admit',
  'adult','advance','advice','aerobic','affair','afford','afraid','again','age','agent',
  'agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert',
  'alien','all','alley','allow','almost','alone','alpha','already','also','alter',
  'always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger',
  'angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique',
  'anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic',
  'area','arena','argue','arm','armed','armor','army','around','arrange','arrest',
  'arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset',
  'assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction',
  'audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake',
  'aware','awesome','awful','awkward','axis','baby','bachelor','bacon','badge','bag',
  'balance','balcony','ball','bamboo','banana','banner','bar','barely','bargain','barrel',
  'base','basic','basket','battle','beach','bean','beauty','because','become','beef',
  'before','begin','behave','behind','believe','below','belt','bench','benefit','best',
  'betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird',
  'birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind',
  'blood','blossom','blow','blue','blur','blush','board','boat','body','boil',
  'bomb','bone','bonus','book','boost','border','boring','borrow','boss','bottom',
  'bounce','box','boy','bracket','brain','brand','brass','brave','bread','breeze',
  'brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom',
  'brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk',
  'bullet','bundle','bunny','burden','burger','burst','bus','business','busy','butter',
  'buyer','buzz','cabbage','cabin','cable','cactus','cage','cake','call','calm',
  'camera','camp','can','canal','cancel','candy','cannon','canoe','canvas','canyon',
  'capable','capital','captain','car','carbon','card','cargo','carpet','carry','cart',
  'case','cash','casino','castle','casual','cat','catalog','catch','category','cattle',
  'caught','cause','caution','cave','ceiling','celery','cement','census','century','cereal',
  'certain','chair','chalk','champion','change','chaos','chapter','charge','chase','cheap',
  'check','cheese','chef','cherry','chest','chicken','chief','child','chimney','choice',
  'choose','chronic','chuckle','chunk','churn','citizen','city','civil','claim','clap',
  'clarify','claw','clay','clean','clerk','clever','click','client','cliff','climb',
  'clinic','clip','clock','clog','close','cloth','cloud','clown','club','clump',
  'cluster','clutch','coach','coast','coconut','code','coffee','coil','coin','collect',
  'color','column','combine','come','comfort','comic','common','company','concert','conduct',
  'confirm','congress','connect','consider','control','convince','cook','cool','copper','copy',
  'coral','core','corn','correct','cost','cotton','couch','country','couple','course',
  'cousin','cover','coyote','crack','cradle','craft','cram','crane','crash','crater',
  'crazy','cream','credit','creek','crew','cricket','crime','crisp','critic','crop',
  'cross','crouch','crowd','crucial','cruel','cruise','crumble','crush','cry','crystal',
  'cube','culture','cup','cupboard','curious','current','curtain','curve','cushion','custom',
  'cute','cycle','dad','damage','damp','dance','danger','daring','dash','daughter',
  'dawn','day','deal','debate','debris','decade','december','decide','decline','decorate',
];

function generatePassword(opts = {}) {
  const { length = 16, uppercase = true, lowercase = true, numbers = true, symbols = true } = opts;

  if (length < 1) {
    throw new Error('Length must be at least 1');
  }

  let charset = '';
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (numbers) charset += '0123456789';
  if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  if (!charset) {
    throw new Error('At least one character type must be enabled');
  }

  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[crypto.randomInt(charset.length)];
  }
  return result;
}

function generatePassphrase(opts = {}) {
  const { words = 4, separator = '-', capitalize = true } = opts;
  const selected = [];
  for (let i = 0; i < words; i++) {
    let word = WORDS[crypto.randomInt(WORDS.length)];
    if (capitalize) word = word[0].toUpperCase() + word.slice(1);
    selected.push(word);
  }
  return selected.join(separator);
}

function calculateEntropy(password) {
  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;
  if (charsetSize === 0) charsetSize = 1;
  return Math.log2(charsetSize) * password.length;
}

function strengthScore(password) {
  const entropy = calculateEntropy(password);
  if (entropy < 28) return 0;
  if (entropy < 40) return 1;
  if (entropy < 60) return 2;
  if (entropy < 100) return 3;
  return 4;
}

module.exports = { generatePassword, generatePassphrase, calculateEntropy, strengthScore };
