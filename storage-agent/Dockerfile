FROM node:20-alpine

RUN apk add --no-cache python3 ruby ruby-nokogiri

# Match the validated desktop MathType converter without copying Windows binaries.
RUN gem install --no-document --ignore-dependencies ruby-ole:1.2.13.1 bindata:2.5.1 mathtype:0.0.8 mathtype_to_mathml_plus:0.0.16 \
    && ruby -e "require 'json'; require 'mathtype_to_mathml_plus'"

WORKDIR /app/storage-agent

COPY shared /app/shared
COPY storage-agent /app/storage-agent
COPY modules/question-bank/parsers/*.py /app/modules/question-bank/parsers/

ENV NODE_ENV=production
ENV QUESTION_IMPORT_PYTHON_BIN=python3
ENV QUESTION_IMPORT_PARSER_PATH=/app/modules/question-bank/parsers/parse_word.py
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["node", "src/launch.js", "/nas-storage/agent.env"]
