# -------- Stage 1: Build --------
FROM maven:3.9.9-eclipse-temurin-17 AS builder

WORKDIR /build

COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src

RUN mvn clean package -DskipTests -B

# -------- Stage 2: Runtime --------
# jammy (Ubuntu), not alpine - eclipse-temurin's alpine variant is amd64-only
# on Docker Hub, which silently breaks the arm64 build this now targets
# (k3s runs on an Oracle Cloud Ampere/ARM VM). jammy is multi-arch.
FROM eclipse-temurin:17-jre-jammy

# Non-root - a compromised JVM (dependency CVE, deserialization bug, etc.)
# shouldn't get root inside its own container just because nothing here
# said otherwise. groupadd/useradd (not addgroup/adduser) - this is a
# Debian-based image now, not Alpine/busybox.
RUN groupadd --system app && useradd --system --no-create-home --gid app app

WORKDIR /app

COPY --from=builder --chown=app:app /build/target/*.jar app.jar

USER app:app

EXPOSE 8082

ENTRYPOINT ["java", "-jar", "app.jar"]
