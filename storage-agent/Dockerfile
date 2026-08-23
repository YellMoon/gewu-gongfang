FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/storage-agent

COPY shared /app/shared
COPY storage-agent /app/storage-agent
COPY modules/question-bank/parsers /app/modules/question-bank/parsers

ENV NODE_ENV=production
ENV QUESTION_IMPORT_PYTHON_BIN=python3
ENV QUESTION_IMPORT_PARSER_PATH=/app/modules/question-bank/parsers/parse_word.py

CMD ["node", "src/main.js"]
