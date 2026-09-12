/* ES5, offline fixture of ConfigureBasePaytable (2026-09-12). No chain requests. */
(function (root) {
  'use strict';
  var lines = [[5,6,7,8,9], [0,1,7,13,14], [10,11,7,3,4]];
  var collection = '0x8D411D8efCDb0d528E4F6659B44223264Fd0B719';
  // Symbol order and weights match DigitalSlotMachine._outcomeForRoll (per 1000).
  var prizes = [
    {label:'MAGNETE', kind:2, token:collection, tokenId:'5', three:94, five:62},
    {label:'FREE SPIN', kind:3, token:'0x0000000000000000000000000000000000000000', tokenId:'0', three:73, five:48},
    {label:'NVIDIA', kind:1, token:'0xb20000000000000000000078ee7ce2fE4908108C', decimals:8, three:48, five:32},
    {label:'GADGET', kind:2, token:collection, tokenId:'1', three:45, five:30},
    {label:'SPACEX', kind:1, token:'0xb2000000000000000000007b9fcbd005511aCBd5', decimals:8, three:38, five:26},
    {label:'APPLE', kind:1, token:'0xb200000000000000000000C2e324d24d7eEcd1fb', decimals:8, three:38, five:26},
    {label:'ALPHABET', kind:1, token:'0xb2000000000000000000002D0BA3164cc74f58B7', decimals:8, three:38, five:26},
    {label:'AMAZON', kind:1, token:'0xb200000000000000000000d9192b6B456483C2E8', decimals:8, three:30, five:20},
    {label:'ENS', kind:2, token:collection, tokenId:'2', three:0, five:100},
    {label:'URBE PASS', kind:2, token:collection, tokenId:'3', three:0, five:67},
    {label:'T-SHIRT', kind:2, token:collection, tokenId:'4', three:0, five:45},
    {label:'GOLD', kind:1, token:'0xe908475f8Beb7A138B0dc6eb5A05cb27068ffB9A', decimals:18, three:0, five:13}
  ];
  function outcomeForRoll(roll) {
    if (roll !== Math.floor(roll) || roll < 0 || roll >= 1000) throw new Error('Invalid demo roll');
    var cursor = 101;
    if (roll < cursor) return {symbol:255, match:0};
    for (var symbol = 0; symbol < prizes.length; symbol++) {
      cursor += prizes[symbol].three; if (roll < cursor) return {symbol:symbol, match:3};
      cursor += prizes[symbol].five; if (roll < cursor) return {symbol:symbol, match:5};
    }
    throw new Error('Incomplete demo paytable');
  }
  function choose(selected, random) {
    if (selected === 'random') return outcomeForRoll(Math.floor(random() * 1000));
    if (selected === 'loss') return {symbol:255, match:0};
    var parts = /^(\d+)-(3|5)$/.exec(selected), symbol = parts ? Number(parts[1]) : -1, match = parts ? Number(parts[2]) : 0;
    if (!prizes[symbol] || !(match === 3 ? prizes[symbol].three : prizes[symbol].five)) throw new Error('Unavailable demo outcome');
    return {symbol:symbol, match:match};
  }
  function buildGrid(outcome, line, random) {
    var result = [], winning = lines[line] || [], excluded = outcome.match ? outcome.symbol : 255;
    for (var column = 0; column < 5; column++) {
      var winningCell = winning[column];
      // As onchain, a 3/5 puts its symbol on another row in columns 3 and 4.
      if (outcome.match === 3 && column >= 3) winningCell = (Math.floor(winningCell / 5) + 1) % 3 * 5 + column;
      for (var row = 0; row < 3; row++) {
        var cell = row * 5 + column, candidates = [];
        if (outcome.match && cell === winningCell) {result[cell] = outcome.symbol; continue;}
        for (var symbol = 0; symbol < prizes.length; symbol++) {
          var used = symbol === excluded;
          for (var previous = 0; previous < row; previous++) if (result[previous * 5 + column] === symbol) used = true;
          if (!used) candidates.push(symbol);
        }
        result[cell] = candidates[Math.floor(random() * candidates.length)];
      }
    }
    if (!outcome.match) {
      for (var index = 0; index < lines.length; index++) {
        var cells = lines[index];
        if (result[cells[0]] === result[7] && result[cells[1]] === result[7]) {
          var first = cells[0], swap = first === 10 ? 0 : first + 5, keep = result[first];
          result[first] = result[swap]; result[swap] = keep; break;
        }
      }
    }
    return result;
  }
  function payout(outcome) {
    if (!outcome.match) return null;
    var prize = prizes[outcome.symbol], stockThree = prize.kind === 1 && outcome.match === 3;
    return {kind:prize.kind, token:prize.token, tokenId:prize.tokenId || '0',
      amount:prize.kind !== 1 ? '1' : prize.decimals === 18 ? '1000000000000000' : stockThree ? '50000' : '100000',
      formattedAmount:prize.kind !== 1 ? '1' : stockThree ? '0.0005' : '0.001',
      tokenSymbol:prize.label, decimals:prize.decimals === undefined ? null : prize.decimals};
  }
  function draw(selected, random) {
    random = random || Math.random;
    var outcome = choose(selected, random), line = outcome.match ? Math.floor(random() * 3) : 255;
    return {won:!!outcome.match, matchCount:outcome.match, winningSymbol:outcome.symbol, winningLine:line,
      symbols:buildGrid(outcome, line, random), payout:payout(outcome)};
  }
  root.slotDemoModel = {prizes:prizes, lines:lines, outcomeForRoll:outcomeForRoll, buildGrid:buildGrid, payout:payout, draw:draw};
}(typeof window === 'undefined' ? module.exports : window));
