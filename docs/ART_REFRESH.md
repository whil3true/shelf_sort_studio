# WebP для полок, товаров и логотипов

Vite подключает установленные WebP из `public/assets/art-refresh/`. Утверждённый комплект из 19 WebP установлен в этих каталогах.

| Путь в проекте | Содержимое |
| --- | --- |
| `public/assets/art-refresh/items/` | 14 WebP с именами из `GOODS` |
| `public/assets/art-refresh/shelves/shelf.webp` | Задняя стенка, основание и кромка одной полки |
| `public/assets/art-refresh/logo/` | `wordmark-ru.webp` и `wordmark-en.webp` |
| `public/assets/art-refresh/ui/` | Иллюстрации меню и победы |

В `src/ui/ArtAssets.ts` указаны игровые ключи, путь WebP и резервный PNG каждого ресурса. При запуске Vite выбирает путь по наличию файла в `public`. При частичной загрузке каждый отсутствующий WebP заменяется соответствующим PNG. После изменения набора файлов перезапустите Vite или пересоберите проект. Пути в сборке относительные, поэтому ресурсы также загружаются в подкаталоге GitHub Pages.

```sh
npm ci
npm run verify
npx playwright install chromium firefox webkit
npm run test:e2e
npm run preview -- --host 0.0.0.0
```

Для проверки откройте адрес из вывода `npm run preview` или, на телефоне в той же сети, адрес компьютера из строки `Network`. Проверьте оба языка в меню, товар в переднем ряду на уровне 01 и занятую заднюю полку на уровне 04 или 10. В разделе Network браузера один запрос на каждый игровой ключ завершается статусом 200. Тест проверяет этот выбор и при полном WebP-комплекте, и при запуске с PNG. Обычная проверка `npm run validate` выводит количество WebP в production-сборке.

Для локальной проверки резервных PNG временно уберите нужные WebP из `public/assets/art-refresh/` и пересоберите проект. Верните файлы перед следующей сборкой. Артефакт `production-dist` в CI содержит готовую сборку текущего PR для проверки перед публикацией.

## Вторая итерация

Все 19 файлов из утверждённого архива `shelf-sort-studio-visual-refresh-webp.zip` установлены по действующим путям. Временные копии WebP из `incoming-assets/` удалены после побайтовой сверки.

| Файлы | Папка в `public/assets/art-refresh/` | Размер |
| --- | --- | --- |
| `apple`, `pear`, `lemon`, `honey`, `jam`, `tea`, `cocoa`, `milk`, `flour`, `cookie`, `soda`, `mint`, `candle`, `soap` (все `.webp`) | `items/` | 192 × 192 |
| `shelf.webp` | `shelves/` | 432 × 272 |
| `wordmark-ru.webp`, `wordmark-en.webp` | `logo/` | 704 × 288 |
| `shop.webp` | `ui/` | 744 × 460 |
| `victory.webp` | `ui/` | 424 × 412 |

Сборка загружает все 19 WebP, включая иллюстрации меню и победы. Для проверки комплекта выполните `npm run verify`, `npm run release:zip` и `npm run test:e2e`.

Nunito Variable заменяет Lora и Manrope. Мягкие окончания штрихов и открытые формы сохраняют читаемость мелких цифр, подписей и кириллицы. В игре используются локальные Latin и Cyrillic WOFF2. Начертание 500 предназначено для пояснений, 600–700 для подписей и кнопок, 800 для заголовков, цифр и основных действий. Лицензия SIL Open Font License 1.1 с уведомлением об авторских правах включена в `public/assets/font-licenses/nunito-OFL.txt` и дистрибутив. [Nunito на Fontsource](https://fontsource.org/fonts/nunito/about)
