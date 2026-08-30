FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY graph.py server.py ./
COPY tests ./tests

EXPOSE 3121
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "3121"]
