FROM node:20-alpine

RUN apk add --no-cache python3

WORKDIR /app/storage-agent

COPY shared /app/shared
COPY storage-agent /app/storage-agent
COPY modules/question-bank/parsers/*.py /app/modules/question-bank/parsers/

ENV NODE_ENV=production
ENV QUESTION_IMPORT_PYTHON_BIN=python3
ENV QUESTION_IMPORT_PARSER_PATH=/app/modules/question-bank/parsers/parse_word.py
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["node", "src/launch.js", "/nas-storage/agent.env"]
