package com.MS_code_execution_platform.problem_service.converter;

import com.MS_code_execution_platform.problem_service.dto.Example;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.io.UncheckedIOException;
import java.util.List;

/**
 * Persists Problem.examples as a single JSON TEXT column - same rationale as
 * StringListConverter/harness.HarnessMapConverter.
 */
@Converter
public class ExampleListConverter implements AttributeConverter<List<Example>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(List<Example> attribute) {
        if (attribute == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(attribute);
        } catch (Exception e) {
            throw new UncheckedIOException("failed to serialize examples", new java.io.IOException(e));
        }
    }

    @Override
    public List<Example> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(dbData, new TypeReference<List<Example>>() {});
        } catch (Exception e) {
            throw new UncheckedIOException("failed to deserialize examples", new java.io.IOException(e));
        }
    }
}
