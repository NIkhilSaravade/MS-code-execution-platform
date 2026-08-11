package com.MS_code_execution_platform.submission_service.config;

import com.MS_code_execution_platform.submission_service.dto.SubmissionUpdateEvent;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.support.serializer.JsonDeserializer;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaConsumerConfig {

    // This factory is built manually (not Spring Boot auto-configured), so none
    // of spring.kafka.* is applied automatically - every property, including
    // the SASL/TLS ones, has to be injected and set explicitly below.
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

    private Map<String, Object> baseConsumerProps(String groupId) {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, groupId);
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        props.put("security.protocol", securityProtocol);
        props.put("sasl.mechanism", saslMechanism);
        props.put("sasl.jaas.config", saslJaasConfig);
        props.put("ssl.truststore.location", trustStoreLocation);
        props.put("ssl.truststore.type", trustStoreType);
        return props;
    }

    // submission-update-topic: the single write-back path for a submission's
    // status, published by execution-result-service once it has persisted a
    // judged result - see kafka.SubmissionUpdateConsumer.
    @Bean
    public ConsumerFactory<String, SubmissionUpdateEvent> submissionUpdateConsumerFactory() {

        JsonDeserializer<SubmissionUpdateEvent> deserializer =
                new JsonDeserializer<>(SubmissionUpdateEvent.class);

        deserializer.addTrustedPackages("*");
        deserializer.setUseTypeHeaders(false);

        return new DefaultKafkaConsumerFactory<>(
                baseConsumerProps("submission-group"),
                new StringDeserializer(),
                deserializer
        );
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, SubmissionUpdateEvent>
    submissionUpdateKafkaListenerContainerFactory() {

        ConcurrentKafkaListenerContainerFactory<String, SubmissionUpdateEvent> factory =
                new ConcurrentKafkaListenerContainerFactory<>();

        factory.setConsumerFactory(submissionUpdateConsumerFactory());

        return factory;
    }
}