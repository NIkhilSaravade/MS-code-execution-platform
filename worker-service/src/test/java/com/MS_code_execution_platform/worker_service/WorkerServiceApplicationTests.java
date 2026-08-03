package com.MS_code_execution_platform.worker_service;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

// The real cert lives at /certs/ca.crt inside the container (see
// docker-compose.yml); this points the context-load smoke test at a local
// copy so `mvn test` also works outside Docker.
@SpringBootTest
@TestPropertySource(properties = "spring.kafka.ssl.trust-store-location=classpath:test-kafka-ca.crt")
class WorkerServiceApplicationTests {

	@Test
	void contextLoads() {
	}

}
