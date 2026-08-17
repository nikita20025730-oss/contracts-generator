// number_to_words_ru.js
// Конвертация суммы в рублях в текстовую форму прописью, с правильным
// согласованием рода (одна/один/два/две) и склонением (тысяча/тысячи/тысяч,
// миллион/миллиона/миллионов) — именно так, как это оформлено во всех
// проверенных реальных договорах, напр.:
//   "272 000,00 (Двести семьдесят две тысячи) рублей 00 копеек"
//
// ВАЖНО: возвращает ТОЛЬКО числительное (без слова "рублей" и без "00 копеек") —
// эти слова уже являются частью текста самого шаблона договора.

const ONES = {
  m: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  f: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
};
const TEENS = [
  "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
  "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

// Разряды выше рублей. Разряд 0 (рубли) не печатает своё слово - оно
// приходит из текста шаблона, см. комментарий в шапке файла.
const SCALES = [
  { forms: ["рубль", "рубля", "рублей"], gender: "m" },       // 0 - рубли (слово не используется)
  { forms: ["тысяча", "тысячи", "тысяч"], gender: "f" },       // 1 - тысячи
  { forms: ["миллион", "миллиона", "миллионов"], gender: "m" }, // 2 - миллионы
  { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "m" }, // 3 - миллиарды
];

/**
 * Выбирает правильную форму слова по числу: forms = [один, два-четыре, пять-...]
 * Стандартное правило русского склонения после числительных.
 */
function pluralize(n, forms) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Переводит число от 0 до 999 в массив слов, с учётом рода для
 * единиц (важно для "один/одна" и "два/две").
 */
function threeDigitToWords(n, gender) {
  const words = [];
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;

  if (hundreds) words.push(HUNDREDS[hundreds]);

  if (remainder >= 10 && remainder < 20) {
    words.push(TEENS[remainder - 10]);
  } else {
    const tens = Math.floor(remainder / 10);
    const ones = remainder % 10;
    if (tens) words.push(TENS[tens]);
    if (ones) words.push(ONES[gender][ones]);
  }

  return words;
}

/**
 * Главная функция: целое неотрицательное число → текст прописью с большой буквы.
 * Поддерживает суммы до 999 999 999 999 (практически без ограничений для реальных договоров).
 *
 * @param {number|string} amount - сумма в рублях (целая часть, копейки не участвуют)
 * @returns {string} напр. "Двести семьдесят две тысячи"
 */
function amountToWordsRu(amount) {
  const n = typeof amount === "string" ? parseInt(amount.replace(/[^\d]/g, ""), 10) : Math.floor(amount);

  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`amountToWordsRu: некорректное значение "${amount}"`);
  }
  if (n === 0) return "Ноль";

  // Разбиваем число на группы по 3 цифры, начиная с младшего разряда (рубли).
  const groups = [];
  let remaining = n;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group === 0) continue;

    const scale = SCALES[i];
    if (!scale) {
      throw new Error(`amountToWordsRu: сумма слишком велика (превышает поддерживаемый разряд)`);
    }

    parts.push(...threeDigitToWords(group, scale.gender));

    if (i > 0) {
      parts.push(pluralize(group, scale.forms));
    }
  }

  const result = parts.join(" ");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * Форматирует число в вид "272 000,00" (пробел как разделитель тысяч,
 * запятая перед копейками) — именно так суммы записаны во всех реальных
 * договорах-образцах.
 *
 * @param {number|string} amount - сумма (может быть с копейками, напр. 272000.50)
 * @returns {string} напр. "272 000,50"
 */
function formatAmountNumeric(amount) {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/[^\d.,]/g, "").replace(",", ".")) : amount;
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`formatAmountNumeric: некорректное значение "${amount}"`);
  }
  const fixed = n.toFixed(2); // "272000.50"
  const [intPart, decPart] = fixed.split(".");
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withSpaces},${decPart}`;
}

/**
 * Удобная функция для прямого использования при сборке данных договора:
 * принимает сумму в рублях (число, без копеек или с ними) и возвращает
 * оба готовых поля сразу.
 *
 * @param {number|string} amount
 * @returns {{ total_amount_numeric: string, total_amount_words: string }}
 */
function buildAmountFields(amount) {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/[^\d.,]/g, "").replace(",", ".")) : amount;
  return {
    total_amount_numeric: formatAmountNumeric(n),
    total_amount_words: amountToWordsRu(Math.floor(n)),
  };
}

module.exports = { amountToWordsRu, formatAmountNumeric, buildAmountFields };
