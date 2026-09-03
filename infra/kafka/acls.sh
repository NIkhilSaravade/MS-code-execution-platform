#!/bin/bash
# Bootstraps topics and least-privilege ACLs. Run once against a healthy
# broker (see the kafka-init service in docker-compose.yml). Idempotent:
# --if-not-exists on topic creation, and re-adding an identical ACL is a no-op.
set -e

BOOTSTRAP="kafka:9093"
CONFIG="/certs/admin-client.properties"

TOPICS="execution-result-topic submissions.created.v1 executions.failed.v1 dlq.submissions.created.v1 submission-update-topic analysis.trigger.v1 analysis.trigger.v1.retry-1 analysis.trigger.v1.retry-2 analysis.trigger.v1.dlq"

echo "Creating topics (if missing)..."
for t in $TOPICS; do
  kafka-topics --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
    --create --if-not-exists --topic "$t" --partitions 3 --replication-factor 1
done

echo "Granting ACLs..."

# worker-service-go: consumes submissions.created.v1, produces results to
# execution-result-topic - nothing consumes executions.completed.v1 anymore
# (removed as part of the single-topic result-reporting redesign;
# executions.failed.v1/dlq stay for worker-side infra-failure reporting, a
# separate concern).
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:worker \
  --operation Read --operation Describe \
  --topic submissions.created.v1 \
  --group worker-service-cg

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:worker \
  --operation Write --operation Describe \
  --topic execution-result-topic \
  --topic executions.failed.v1 --topic dlq.submissions.created.v1

# submission-service: produces submissions.created.v1 (worker-service-go);
# consumes submission-update-topic to update a submission's status once
# execution-result-service has persisted the full result (no longer reads
# execution-result-topic directly - execution-result-service is the only
# consumer of that topic now).
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:submission_service \
  --operation Write --operation Describe \
  --topic submissions.created.v1

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:submission_service \
  --operation Read --operation Describe \
  --topic submission-update-topic --group submission-group

# execution-result-service: reads execution-result-topic (from either
# worker), produces submission-update-topic (submission-service) and
# analysis.trigger.v1 (ai-analysis-service).
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:execution_result_service \
  --operation Read --operation Describe \
  --topic execution-result-topic --group execution-result-group

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:execution_result_service \
  --operation Write --operation Describe \
  --topic submission-update-topic --topic analysis.trigger.v1

# ai-analysis-service: consumes analysis.trigger.v1 (and its own delayed
# retry topics) to run its LLM analysis automatically after a submission is
# judged, and produces to those retry topics plus a DLQ topic when
# processing fails (see ai-analysis-service/kafka/consumer.py's retry/DLQ
# topology).
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:ai_analysis_service \
  --operation Read --operation Describe \
  --topic analysis.trigger.v1 --topic analysis.trigger.v1.retry-1 \
  --topic analysis.trigger.v1.retry-2 --group ai-analysis-group

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:ai_analysis_service \
  --operation Write --operation Describe \
  --topic analysis.trigger.v1.retry-1 --topic analysis.trigger.v1.retry-2 \
  --topic analysis.trigger.v1.dlq

echo "Kafka topics and ACLs configured."
