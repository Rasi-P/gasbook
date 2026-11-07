FROM python:3.12.15-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.0 \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY . .

RUN GASBOOK_ENV=development DEBUG=False python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "gasbook.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "120"]
