import type { Locale } from '../platform/Storage.ts';

const en = {
  titleTop: 'Shelf Sort', titleBottom: 'Studio', theme: 'A little shop to put in order',
  play: 'Play', resume: 'Continue', settings: 'Settings', help: 'How to play', back: 'Back', close: 'Close',
  chapters: 'Choose a level', chapter: 'Chapter', level: 'Level', completed: 'completed',
  chapter1: 'The Corner Shop', chapter2: 'Pantry Essentials', chapter3: 'The Stockroom',
  locked: 'Locked', cleared: 'Complete', undo: 'Undo', restart: 'Restart', exit: 'Exit',
  hint: 'Hint', music: 'Music', effects: 'Sound effects', language: 'Language',
  intro: 'Move an item to any empty slot.',
  pair: 'Put three identical items on one shelf.',
  hidden: 'Empty a shelf to bring forward its stock.',
  goal: 'Clear every shelf, including the stock.',
  help1: 'Drag an item onto an empty slot, or tap the item and then the slot.',
  help2: 'Three matching items on one shelf are packed away automatically.',
  help3: 'When the front row is empty, the next row comes forward.',
  help4: 'Campaign Undo is free. In Endless Mode, watch an ad to undo a move.',
  restartTitle: 'Restart this level?', restartText: 'Your moves on this level will be reset.',
  replaceTitle: 'Switch levels?', replaceText: 'Your current board will be reset.',
  cancel: 'Cancel', next: 'Next level', levelSelect: 'Level selection', noSpace: 'No empty slots. Undo a move or restart.',
  won: 'Shelves cleared!', wonAll: 'The shop is in order!', wonText: 'Every item is packed away.',
  wonAllText: 'You cleared all 18 levels.', watch: 'Watch ad', hintTitle: 'See the next move?',
  hintText: 'Watch an ad to highlight a move with a verified path to victory.',
  checking: 'Checking the shelves…', noHint: 'No solution from here. Try Undo.',
  hintLimit: 'A move could not be verified. Try Undo.', noAd: 'Ad unavailable. Try again later.',
  loadingAd: 'Waiting for ad…',
  endless: 'Endless Mode', newRun: 'New run', score: 'Score', best: 'Best score', matches: 'Triples cleared',
  endlessIntro: 'Clear triples. New stock arrives behind the front rows.',
  endlessLost: 'The shelves are full', endlessLostText: 'There are no moves left.',
  endlessRestart: 'Start a new run?', endlessRestartText: 'This run will end. Your best score will be kept.',
  undoTitle: 'Undo the last move?', undoText: 'Watch an ad to restore the board and score before your last move.',
  undoAd: 'Undo with ad', mainMenu: 'Main menu', results: 'Results',
} as const;

type Key = keyof typeof en;

const ru: Record<Key, string> = {
  titleTop: 'Порядок', titleBottom: 'на полках', theme: 'Уютная лавка головоломок',
  play: 'Играть', resume: 'Продолжить', settings: 'Настройки', help: 'Как играть', back: 'Назад', close: 'Закрыть',
  chapters: 'Выбор уровня', chapter: 'Глава', level: 'Уровень', completed: 'пройдено',
  chapter1: 'Лавка на углу', chapter2: 'Запасы в кладовой', chapter3: 'Дальний склад',
  locked: 'Закрыт', cleared: 'Пройден', undo: 'Отменить', restart: 'Заново', exit: 'Выход',
  hint: 'Подсказка', music: 'Музыка', effects: 'Звуки', language: 'Язык',
  intro: 'Перенесите товар в любую пустую ячейку.',
  pair: 'Соберите три одинаковых товара на полке.',
  hidden: 'Освободите полку, чтобы открыть запас.',
  goal: 'Уберите все товары, включая запасы.',
  help1: 'Перетащите товар в пустую ячейку или нажмите сначала на товар, затем на ячейку.',
  help2: 'Три одинаковых товара на одной полке убираются автоматически.',
  help3: 'Когда передний ряд пуст, товары из запаса выдвигаются вперёд.',
  help4: 'В кампании отмена хода бесплатна. В бесконечном режиме за неё нужно посмотреть рекламу.',
  restartTitle: 'Начать уровень заново?', restartText: 'Ходы на этом уровне сбросятся.',
  replaceTitle: 'Сменить уровень?', replaceText: 'Текущая раскладка сбросится.',
  cancel: 'Отмена', next: 'Следующий уровень', levelSelect: 'К выбору уровня', noSpace: 'Нет свободных мест. Отмените ход или начните заново.',
  won: 'Полки свободны!', wonAll: 'В лавке порядок!', wonText: 'Все товары упакованы.',
  wonAllText: 'Вы прошли все 18 уровней.', watch: 'Смотреть', hintTitle: 'Показать следующий ход?',
  hintText: 'После рекламы игра выделит ход, для которого найдено решение.',
  checking: 'Проверяем раскладку…', noHint: 'Решения нет. Попробуйте отменить ход.',
  hintLimit: 'Ход подтвердить не удалось. Попробуйте отменить ход.', noAd: 'Реклама недоступна. Попробуйте позже.',
  loadingAd: 'Ждём рекламу…',
  endless: 'Бесконечный режим', newRun: 'Новая партия', score: 'Очки', best: 'Рекорд', matches: 'Собрано троек',
  endlessIntro: 'Собирайте тройки. Новые запасы появляются за товарами.',
  endlessLost: 'Полки заполнены', endlessLostText: 'Свободных ячеек для хода больше нет.',
  endlessRestart: 'Начать новую партию?', endlessRestartText: 'Текущая партия завершится. Рекорд сохранится.',
  undoTitle: 'Отменить последний ход?', undoText: 'Посмотрите рекламу, чтобы вернуть раскладку и очки до последнего хода.',
  undoAd: 'Отмена за рекламу', mainMenu: 'Главное меню', results: 'Результат',
};

export const CHAPTERS: readonly Key[] = ['chapter1', 'chapter2', 'chapter3'];
export type TextKey = Key;
export function word(locale: Locale, key: Key): string {
  return locale === 'ru' ? ru[key] : en[key];
}
