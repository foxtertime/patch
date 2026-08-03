"""Пакет kojipatch: сбор данных koji и GitLab, дашборд патчей."""
import logging

# библиотека не навязывает вывод: без настройки записи уходят в никуда
logging.getLogger(__name__).addHandler(logging.NullHandler())
