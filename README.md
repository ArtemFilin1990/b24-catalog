# b24-catalog — Каталог подшипников для Bitrix24

Cloudflare Worker с D1 базой для B2B каталога ООО Эверест.

## Архитектура

- **Worker** `b24-catalog` отдаёт HTML каталога + обрабатывает API
- **Assets** в `public/` — HTML каталога 2.38 MB + install.html
- **D1 база** `baza` (id: `11a157a7-c3e0-4b6b-aa24-3026992db298`) — импорты и заявки

## API endpoints

| Путь | Метод | Что делает |
|---|---|---|
| `/` | GET | Каталог HTML (86191 позиций) |
| `/app` | GET | Алиас для `/` (для Bitrix24) |
| `/install` | GET/POST | Bitrix24 install handler |
| `/api/ping` | GET | Healthcheck |
| `/api/imports` | GET | Все активные импорты |
| `/api/imports` | POST | Сохранить пакет строк |
| `/api/imports/:session_id` | DELETE | Удалить сессию |
| `/api/sessions` | GET | Список сессий импорта |
| `/api/orders` | POST | Создать заявку + в Bitrix24 |
| `/api/orders` | GET | Список заявок |

## В Bitrix24

URL обработчика в приложении `app/1535/`:
```
https://b24-catalog.35ewerest.workers.dev/
```

URL установки:
```
https://b24-catalog.35ewerest.workers.dev/install
```

## D1 таблицы

- `imported_rows` — импортированные позиции
- `import_sessions` — сессии загрузки
- `orders` — заявки (копия того что ушло в Bitrix24)

## Bitrix24 webhook

Заявки уходят в воронку 87 («Холодные звонки») — единственная без обязательного поля «Кол-во дней отсрочки».
