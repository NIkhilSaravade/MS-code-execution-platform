package com.MS_code_execution_platform.problem_service.converter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.io.UncheckedIOException;
import java.util.List;

/**
 * Persists Problem.tags as a single JSON TEXT column rather than a join
 * table - same rationale as harness.HarnessMapConverter (write-once at
 * problem creation, read-whole, no per-tag querying needed).
 */
@Converter
public class StringListConverter implements AttributeConverter<List<String>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(List<String> attribute) {
        if (attribute == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(attribute);
        } catch (Exception e) {
            throw new UncheckedIOException("failed to serialize tags", new java.io.IOException(e));
        }
    }

    @Override
    public List<String> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(dbData, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new UncheckedIOException("failed to deserialize tags", new java.io.IOException(e));
        }
    }
}
