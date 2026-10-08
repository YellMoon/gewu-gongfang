'use strict';
// Presentation only: explicit number/known-unit pairs in sanitized question HTML.
// Tags, media paths, attributes, precision and stored question content stay intact.
const unit = '(?:[kMGmμµn]?Hz|[kMμµm]?Pa|[kμµmn]?N|[kμµmn]?J|[kMμµm]?W|[kμµmn]?C|[kμµmn]?V|[kμµmn]?A|[kμµmn]?T|[kμµm]?Ω|kg|[kcmμµn]?m(?:/[kcmμµn]?s(?:[²³]|\\^[23])?)?|[mμµn]?s|[mμµ]?g|°C|rad)';
const pair = new RegExp('([−+\\-]?\\d+(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?) +(' + unit + ')(?![A-Za-z0-9μµ])', 'g');
function keepNumericUnitsTogether(html) {
  return String(html || '').split(/(<(?:[^"'<>]|"[^"]*"|'[^']*')*>)/g).map(fragment => fragment.startsWith('<') ? fragment : fragment.replace(pair, '$1\u00a0$2')).join('');
}
module.exports = { keepNumericUnitsTogether };
