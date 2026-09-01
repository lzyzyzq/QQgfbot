export function startGuess(): number {
  return Math.floor(Math.random() * 100) + 1;
}

export function guessCompare(answer: number, guess: number): string {
  if (guess < answer) return '📈 小了，继续猜（1-100）';
  if (guess > answer) return '📉 大了，继续猜（1-100）';
  return '🎉 恭喜猜中！答案是 ' + answer;
}

export function slots(): string {
  const syms = ['🍒', '🍋', '🍇', '💎', '7️⃣', '⭐'];
  const a = syms[Math.floor(Math.random() * syms.length)];
  const b = syms[Math.floor(Math.random() * syms.length)];
  const c = syms[Math.floor(Math.random() * syms.length)];
  const line = a + ' | ' + b + ' | ' + c;
  if (a === b && b === c) return '🎰 ' + line + '\n🎉 三连！大奖！';
  if (a === b || b === c || a === c) return '🎰 ' + line + '\n✨ 中了一个，继续加油';
  return '🎰 ' + line + '\n😅 没中，再来一次';
}
