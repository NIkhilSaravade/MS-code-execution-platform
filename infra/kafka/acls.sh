#!/bin/bash
# Bootstraps topics and least-privilege ACLs. Run once against a healthy
# broker (see the kafka-init service in docker-compose.yml). Idempotent:
# --if-not-exists on topic creation, and re-adding an identical ACL is a no-op.
set -e

BOOTSTRAP="kafka:9093"
CONFIG="/certs/admin-client.properties"

TOPICS="submission-topic execution-result-topic submissions.created.v1 executions.completed.v1 executions.failed.v1 dlq.submissions.created.v1"

echo "Creating topics (if missing)..."
for t in $TOPICS; do
  kafka-topics --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
    --create --if-not-exists --topic "$t" --partitions 3 --replication-factor 1
done

echo "Granting ACLs..."

# worker (both the old Java worker-service and worker-service-go share this
# trust boundary - see the guide's phrasing, "the worker"): consume the
# submission topics, produce the execution-result topics. Nothing else.
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:worker \
  --operation Read --operation Describe \
  --topic submission-topic --topic submissions.created.v1 \
  --group worker-group --group worker-service-cg

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:worker \
  --operation Write --operation Describe \
  --topic execution-result-topic --topic executions.completed.v1 \
  --topic executions.failed.v1 --topic dlq.submissions.created.v1

# submission-service: produces submission-topic (legacy Java worker) and
# submissions.created.v1 (worker-service-go), consumes execution-result-topic
# to update a submission's status once the worker finishes.
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:submission_service \
  --operation Write --operation Describe \
  --topic submission-topic --topic submissions.created.v1

kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:submission_service \
  --operation Read --operation Describe \
  --topic execution-result-topic --group submission-group

# execution-result-service: only ever reads execution-result-topic.
kafka-acls --bootstrap-server "$BOOTSTRAP" --command-config "$CONFIG" \
  --add --allow-principal User:execution_result_service \
  --operation Read --operation Describe \
  --topic execution-result-topic --group execution-result-group

echo "Kafka topics and ACLs configured."
