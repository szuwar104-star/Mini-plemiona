/* =========================================================================
   Mini Plemiona – GRAFIKA PIKSELOWA (generowane SVG, działa offline)
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP = root.MP || {};
  const PAL = {
    k: '#2a1c10', b: '#7a4a22', B: '#a8703a', l: '#dcb479', w: '#f3e6c4',
    r: '#a8432a', R: '#d2694a', g: '#6b7078', G: '#a9aeb5', W: '#eef0f2',
    s: '#8ea4ba', S: '#cbd8e4', y: '#d9a92e', Y: '#f3d777', e: '#3c6e30', E: '#67a04a'
  };

  // Zamienia tablicę napisów na SVG; poziome serie pikseli łączone w jeden prostokąt.
  function pix(rows, extra, cls) {
    const h = rows.length, w = rows[0].length;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" shape-rendering="crispEdges" class="' + (cls || 'pix') + '" aria-hidden="true">';
    rows.forEach((row, y) => {
      let x = 0;
      while (x < w) {
        const ch = row[x];
        let n = 1;
        while (x + n < w && row[x + n] === ch) n++;
        if (ch !== '.') {
          const col = (extra && extra[ch]) || PAL[ch] || '#f0f';
          s += '<rect x="' + x + '" y="' + y + '" width="' + n + '" height="1.02" fill="' + col + '"/>';
        }
        x += n;
      }
    });
    return s + '</svg>';
  }

  const ART = {
    wood: [
      '............', '............', '.kkkkkkkkkk.', 'kbbBbbbBbklk', 'kbbbbBbbbkwk', 'kbBbbbbBbklk',
      '.kkkkkkkkkk.', 'kbBbbbbBbklk', 'kbbbbBbbbkwk', 'kbbBbbbBbklk', '.kkkkkkkkkk.', '............'],
    clay: [
      '............', '............', '............', 'kkkkkkkkkkkk', 'kRrrrkRrrrrk', 'krrrrkrrrrrk',
      'kkkkkkkkkkkk', 'kRrkRrrrrkRk', 'krrkrrrrrkrk', 'kkkkkkkkkkkk', '............', '............'],
    iron: [
      '............', '............', '............', '...kkkkkk...', '..kSSSSSSk..', '.kSsSSSSssk.',
      'kssssssssssk', 'kgsssssssggk', 'kkkkkkkkkkkk', '............', '............', '............'],
    pop: [
      '............', '....kkkk....', '...kllllk...', '...kllllk...', '....kkkk....', '..kkbbbbkk..',
      '.kbbbbbbbbk.', '.kbkbbbbkbk.', '.kbkbbbbkbk.', '...kbkkbk...', '...kbk.kbk..', '...kkk.kkk..'],
    hq: [
      '......k.....', '......kRR...', '......kRR...', '......k.....', '...kkkkkkk..', '..krrrrrrrk.',
      '.krrrrrrrrrk', 'kkkkkkkkkkkk', '.kllllllllk.', '.klbbllbblk.', '.klllbblllk.', '.kkkkbbkkkk.'],
    pick: [
      '............', '..kkkkkkk...', '.kGGGGGGGk..', 'kGkkkbkkkGk.', 'kk...bk...kk', '.....bk.....',
      '.....bk.....', '.....bk.....', '.....bk.....', '.....bk.....', '....kbk.....', '....kkk.....'],
    farm: [
      '............', '.....kk.....', '....kRRk....', '...kRrrRk...', '..kRrrrrRk..', '.kRrrrrrrRk.',
      'kRrrrrrrrrRk', '.krrkkkkrrk.', '.krrkwwkrrk.', '.krrkwwkrrk.', '.krrkwwkrrk.', '.kkkkkkkkkk.'],
    barracks: [
      '.kkkkkkkkkk.', '.kGGGGrrrrk.', '.kGGGGrrrrk.', '.kGGGGrrrrk.', '.kyyyyyyyyk.', '.krrrrGGGGk.',
      '.krrrrGGGGk.', '..krrrGGGk..', '...krrGGk...', '....krGk....', '.....kk.....', '............'],
    spear: [
      '.......kk.......',
      '......kSWk......',
      '.....kSSWSk.....',
      '.....kSSWSk.....',
      '......kSSk......',
      '.....kkkkkk.....',
      '.......kbkkkk...',
      '.......kbkRRRk..',
      '.......kbkRRk...',
      '.......kbkkk....',
      '.......kBk......',
      '.......kbk......',
      '.......kBk......',
      '.......kbk......',
      '.......kBk......',
      '.......kkk......'],
    axe: [
      '..kkkkkkkk......',
      '.kWWWGGGGkkk....',
      'kWWGGGGGGGkBk...',
      'kWGGGGGGGGkBk...',
      'kGGGGGGGGGkBk...',
      'kGGGGGGGGgkBk...',
      '.kGGGGGGGkkBk...',
      '..kkkGGGGkkBk...',
      '....kkkkkkkBk...',
      '..........kBk...',
      '..........kBk...',
      '..........kbk...',
      '..........kBk...',
      '..........kbk...',
      '..........kBk...',
      '..........kkk...'],
    light: [
      '...kk......kk...',
      '..kBBk....kBBk..',
      '..kBbbkkkkbbBk..',
      '..kBbbbwwbbbBk..',
      '..kbbbbwwbbbbk..',
      '..kbkbbwwbbkbk..',
      '..kbbbbwwbbbbk..',
      '...kbbbwwbbbk...',
      '....kbbwwbbk....',
      '....kbbwwbbk....',
      '....kbbwwbbk....',
      '....kllllllk....',
      '....kllllllk....',
      '....klkllklk....',
      '.....kkkkkk.....',
      '................'],
    noble: [
      '................',
      '................',
      '................',
      '..k....kk....k..',
      '.kyk..kyyk..kyk.',
      '.kyyk.kyyk.kyyk.',
      '.kyyykkyykkyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyYyyyRRyyyYyk.',
      '.kyyyyyyyyyyyyk.',
      '.kkkkkkkkkkkkkk.',
      '.kRRRRRRRRRRRRk.',
      '.kkkkkkkkkkkkkk.',
      '................',
      '................',
      '................'],
    archer: [
      '................',
      '....kkk.........',
      '...kBBbkk.......',
      '..kBbkwk........',
      '..kbk.wk........',
      '.kBbk.wk........',
      '.kbk..wk........',
      '.kBk..wk........',
      '.kbkRRSSSSSSSWk.',
      '.kBk..wk........',
      '.kbk..wk........',
      '.kBbk.wk........',
      '..kbk.wk........',
      '..kBbkwk........',
      '...kBBbkk.......',
      '....kkk.........'],
    sword: [
      '..........kk', '.........kSk', '........kSk.', '.......kSk..', '......kSk...', '.k...kSk....',
      '.kk.kSk.....', '..kkSk......', '..kyk.......', '.kykkk......', 'kyk..k......', 'kk..........'],
    wall: [
      '............', '.kkk.kkk.kkk', '.kGk.kGk.kGk', 'kkkkkkkkkkkk', 'kGGGkGGGGkGk', 'kGGGkGGGGkGk',
      'kkkkkkkkkkkk', 'kGkGGGGkGGGk', 'kGkGGGGkGGGk', 'kkkkkkkkkkkk', 'kGGGGkGGGGGk', 'kkkkkkkkkkkk'],
    ram: [
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '...kRRRRRRRRk...',
      '..kRrrrrrrrrRk..',
      '..kkkkkkkkkkkk..',
      '..kb........bk..',
      '.kBBBBBBBBBBkSSk',
      '.kbbbbbbbbbbkSSk',
      '.kkkkkkkkkkkkkkk',
      '..kb........bk..',
      '..kGGk....kGGk..',
      '.kGgGGk..kGGgGk.',
      '..kGGk....kGGk..',
      '................'],
    scout: [
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '..kkwwwwwwwwkk..',
      '.kwwwkkkkkkwwwk.',
      'kwwkssSSSSsskwwk',
      'kwwksSkkkkSskwwk',
      'kwwksSkkkkSskwwk',
      'kwwkssSSSSsskwwk',
      '.kwwwkkkkkkwwwk.',
      '..kkwwwwwwwwkk..',
      '....kkkkkkkk....',
      '................',
      '................',
      '................'],
    settler: [
      '................',
      '................',
      '....kkkkkkkk....',
      '..kkwwwwwwwwkk..',
      '.kwwwwwwwwwwwwk.',
      '.kwwwlwwwwlwwwk.',
      '.kwwwwwwwwwwwwk.',
      'kkkkkkkkkkkkkkkk',
      'kbbbbbbbbbbbbbbk',
      'kBBbbbbbbbbbbbbk',
      'kkkkkkkkkkkkkkkk',
      '..kkkk....kkkk..',
      '.kGGGGk..kGGGGk.',
      '.kGkkGk..kGkkGk.',
      '.kGGGGk..kGGGGk.',
      '..kkkk....kkkk..'],
    market: [
      '............', 'kkkkkkkkkkkk', 'kRwRwRwRwRwk', 'kRwRwRwRwRwk', '.kkkkkkkkkk.', '.kb......bk.',
      '.kb.yyY..bk.', '.kbkkkkkkbk.', '.kbllllllbk.', '.kbllllllbk.', '.kbkkkkkkbk.', '............'],
    merchant: [
      '............', '....kkkk....', '.....kk.....', '....kbbk....', '...kBBBBk...', '..kBbbbbBk..',
      '.kBbbyybbBk.', '.kBbyYybbBk.', '.kBbbyybbBk.', '.kBbbbbbbBk.', '..kkkkkkkk..', '............'],
    map: [
      '............', '.kkkkkkkkkk.', '.kwwwwwwwwk.', '.kwEEwwwwwk.', '.kwEEwkwwwk.', '.kwwkwwRwRk.',
      '.kwkwwwwRwk.', '.kwwwwwRwRk.', '.kwwGGwwwwk.', '.kwGGGwwwwk.', '.kwwwwwwwwk.', '.kkkkkkkkkk.'],
    scroll: [
      '............', '..kkkkkkkk..', '.kllkwwwwwk.', '..kkwkkkkwk.', '....kwwwwwk.', '....kwkkkwk.',
      '....kwwwwwk.', '....kwkkwwk.', '....kwwwwwk.', '..kkkkkkkkk.', '.klllllllk..', '..kkkkkkk...'],
    menu: [
      '............', '.kkkkkkkkkk.', '.kyyyyyyyyk.', '.kkkkkkkkkk.', '............', '.kkkkkkkkkk.',
      '.kyyyyyyyyk.', '.kkkkkkkkkk.', '............', '.kkkkkkkkkk.', '.kyyyyyyyyk.', '.kkkkkkkkkk.'],
    village: [
      '................', '................', '......kk........', '.....kFFk.......', '....kFFFFk......',
      '...kFFFFFFk.kk..', '..kFFFFFFFFkFFk.', '...kllllllkFFFFk', '...klbbllbkkkkkk', '...klbbllbklllk.',
      '...kllllllklblk.', '...kllbbllklblk.', '...kkkbbkkkkkkk.', '................', '................', '................'],
    forest: [
      '................', '....e...........', '...eEe......e...', '..eEEEe....eEe..', '.eEEEEEe..eEEEe.',
      '..eEEEe..eEEEEEe', '.eEEEEEe..eEEEe.', 'eEEEEEEEe.eEEEe.', '...kbk...eEEEEEe', '...kbk....kbk...',
      '......e...kbk...', '.....eEe........', '....eEEEe.......', '...eEEEEEe......', '......kbk.......', '................'],
    mountain: [
      '................', '................', '................', '.......kk.......', '......kWWk......',
      '.....kWWWGk.....', '....kGWGGGGk....', '...kGGGgGGGGk...', '..kGGgggGGGgGk..', '.kGgggGGgggGGGk.',
      'kGggggggggggGGgk', 'kkkkkkkkkkkkkkkk', '................', '................', '................', '................']
  };

  const cache = {};
  function icon(name) {
    if (!cache[name]) cache[name] = pix(ART[name]);
    return cache[name];
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function village(color) {
    const key = 'village' + color;
    if (!cache[key]) cache[key] = pix(ART.village, { F: color, f: shade(color, 0.7) }, 'pix tile-art');
    return cache[key];
  }
  function terrain(name) {
    const key = 't-' + name;
    if (!cache[key]) cache[key] = pix(ART[name], null, 'pix tile-art');
    return cache[key];
  }

  MP.Sprites = {
    icon, village, terrain,
    building: { hq: 'hq', wood: 'wood', clay: 'clay', iron: 'pick', farm: 'farm', barracks: 'barracks', market: 'market', wall: 'wall' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
