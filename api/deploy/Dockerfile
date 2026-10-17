FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# requirements.txt is maintained by the API implementation, not this deployment example.
COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

COPY api /app/api
COPY pipeline/inst/extdata/theme-metadata /app/pipeline/inst/extdata/theme-metadata
COPY pipeline/inst/extdata/semantic-resource-contracts.json /app/pipeline/inst/extdata/semantic-resource-contracts.json

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
