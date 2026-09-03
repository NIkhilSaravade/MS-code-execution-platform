# -------- Stage 1: Build --------
FROM maven:3.9.9-eclipse-temurin-17 AS builder

WORKDIR /build

COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src

RUN mvn clean package -DskipTests -B

# -------- Stage 2: Runtime --------
FROM eclipse-temurin:17-jre-alpine

# Non-root - a compromised JVM (dependency CVE, deserialization bug, etc.)
# shouldn't get root inside its own container just because nothing here
# said otherwise.
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder --chown=app:app /build/target/*.jar app.jar

USER app:app

EXPOSE 8081 9090

ENTRYPOINT ["java", "-jar", "app.jar"]
