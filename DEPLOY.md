# Развёртывание Mini App «Фулфилмент»

## Быстрый старт

```bash
npm install
cp .env.example .env   # заполнить токены
npm start
```

## Переменные окружения (.env)

| Переменная | Описание |
|---|---|
| PORT | Порт сервера (по умолчанию 3000) |
| BOT_TOKEN | Токен Telegram бота (@BotFather) |
| CHAT_ID | ID чата админа для уведомлений |
| ADMIN_KEY | Ключ админа (для API) |
| ADMIN_LOGIN | Логин админа по умолчанию |
| ADMIN_PASSWORD | Пароль админа по умолчанию |

## Переезд на хостинг

1. Скопировать папку `fulfillment-map` на сервер
2. `npm install`
3. Заполнить `.env`
4. Настроить домен (nginx reverse proxy на порт 3000)
5. В BotFather: `/setmenubutton` → указать URL домена
6. Проверить что работает через домен

## Структура

- server.js — сервер Express, API, авторизация
- cities.js — список городов (87 РФ + международные)
- data.json — база данных (заявки, пользователи, токены)
- public/ — статические файлы (HTML, CSS, JS)
