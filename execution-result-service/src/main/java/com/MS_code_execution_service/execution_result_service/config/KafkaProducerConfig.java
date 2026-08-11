package com.MS_code_execution_service.execution_result_service.config;

import com.MS_code_execution_service.execution_result_service.dto.AnalysisTriggerEvent;
import com.MS_code_execution_service.execution_result_service.dto.SubmissionUpdateEvent;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.*;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaProducerConfig {

    // This factory is built manually (not Spring Boot auto-configured), so none
    // of spring.kafka.* is applied automatically - every property, including
    // the SASL/TLS ones, has to be injected and set explicitly below. Mirrors
    // KafkaConsumerConfig (which already did this correctly) and
    // submission-service's KafkaProducerConfig - this bean previously
    // hardcoded localhost:9092 with no SASL/TLS at all, which never actually
    // worked against the real, SASL_SSL-only broker.
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

        // Disable type headers (clean microservice design)
        config.put(JsonSerializer.ADD_TYPE_INFO_HEADERS, false);

        return config;
    }

    @Bean
    public ProducerFactory<String, SubmissionUpdateEvent> producerFactory() {
        return new DefaultKafkaProducerFactory<>(baseProducerConfig());
    }

    @Bean
    public KafkaTemplate<String, SubmissionUpdateEvent> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }

    // Second producer for analysis.trigger.v1 - published alongside
    // submission-update-topic once a result is persisted, see
    // ExecutionResultService.
    @Bean
    public ProducerFactory<String, AnalysisTriggerEvent> analysisTriggerProducerFactory() {
        return new DefaultKafkaProducerFactory<>(baseProducerConfig());
    }

    @Bean
    public KafkaTemplate<String, AnalysisTriggerEvent> analysisTriggerKafkaTemplate() {
        return new KafkaTemplate<>(analysisTriggerProducerFactory());
    }
}
