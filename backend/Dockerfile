FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

EXPOSE 5000

CMD ["gunicorn", "-w", "2", "--timeout", "120", "--worker-class", "sync", "-b", "0.0.0.0:5000", "app:create_app()"]
