package com.MS_code_execution_platform.submission_service.config;

import com.MS_code_execution_platform.submission_service.dto.SubmissionCreatedEvent;
import com.MS_code_execution_platform.submission_service.dto.SubmissionEvent;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaProducerConfig {

    // This factory is built manually (not Spring Boot auto-configured), so none
    // of spring.kafka.* is applied automatically - every property, including
    // the SASL/TLS ones, has to be injected and set explicitly below. Mirrors
    // KafkaConsumerConfig, which already does this correctly.
    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Value("${spring.kafka.security.protocol}")
    private String securityProtocol;

    @Value("${spring.kafka.properties.sasl.mechanism}")
    private String saslMechanism;

    @Value("${spring.kafka.properties.sasl.jaas.config}")
    private String saslJaasConfig;

    @Value("${spring.kafka.ssl.trust-store-location}")
    private String trustStoreLocation;

    @Value("${spring.kafka.ssl.trust-store-type}")
    private String trustStoreType;

    private Map<String, Object> baseProducerConfig() {
        Map<String, Object> config = new HashMap<>();

        config.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        config.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        config.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class);
        config.put("security.protocol", securityProtocol);
        config.put("sasl.mechanism", saslMechanism);
        config.put("sasl.jaas.config", saslJaasConfig);
        config.put("ssl.truststore.location", trustStoreLocation);
        config.put("ssl.truststore.type", trustStoreType);

        // Disable type headers (microservice safe)
        config.put(JsonSerializer.ADD_TYPE_INFO_HEADERS, false);

        return config;
    }

    @Bean
    public ProducerFactory<String, SubmissionEvent> producerFactory() {
        return new DefaultKafkaProducerFactory<>(baseProducerConfig());
    }

    @Bean
    public KafkaTemplate<String, SubmissionEvent> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }

    // Second producer for the newer submissions.created.v1 event shape that
    // worker-service-go consumes (see SubmissionCreatedEvent) - published
    // alongside the legacy SubmissionEvent so both worker-service (Java) and
    // worker-service-go keep receiving submissions, per CLAUDE.md's
    // "both workers run side by side intentionally" note.
    @Bean
    public ProducerFactory<String, SubmissionCreatedEvent> submissionCreatedProducerFactory() {
        return new DefaultKafkaProducerFactory<>(baseProducerConfig());
    }

    @Bean
    public KafkaTemplate<String, SubmissionCreatedEvent> submissionCreatedKafkaTemplate() {
        return new KafkaTemplate<>(submissionCreatedProducerFactory());
    }
}