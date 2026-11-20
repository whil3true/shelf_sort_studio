# Shelf Sort Studio · Порядок на полках

Уютная головоломка про маленькую лавку. Перетаскивайте товары или выбирайте их тапом и указывайте пустой слот. Тройка одинаковых товаров убирается, а пустая полка открывает следующий ряд. Кампания состоит из трёх глав и 18 уровней. Undo и перезапуск бесплатны.

## Запуск и выпуск

Требуются Node.js 22+ и Python 3 для проверки релиза.

```sh
npm ci
npm run dev
npm run verify
npx playwright install --with-deps
npm run test:e2e
npm run release
```

Phaser 4.2.1 рисует весь интерфейс в Canvas с логическим размером 480×800. `npm run assets` воспроизводит оригинальные PNG из `scripts/create-art.mjs`. Сборка запускает этот шаг автоматически, итоговые картинки доступны в `dist/assets/art/`.

Архив `yandex-upload-ready.zip` содержит `index.html` в корне. Такой же архив CI публикует в артефакте `yandex-upload-ready`. В консоль Яндекс Игр загружайте одноимённый файл внутри артефакта. Сохранения локальные и привязаны к origin.

Для сайта выберите **Settings → Pages → Build and deployment → Source → GitHub Actions**. Публикация запускается при push в `dev`. Адрес проекта после первого успешного деплоя — https://whil3true.github.io/shelf_sort_studio/.

- [Решения доноров](docs/ARCHITECTURE_REUSE.md)
- [Исследование Goods Sort](docs/GOODS_SORT_RESEARCH.md)
- [Границы переиспользуемых модулей](docs/REUSABLE_FOUNDATION.md)
- [Подключение аудио](docs/AUDIO_INTEGRATION.md)
- [Проверка на Android](docs/ANDROID_QA.md)
