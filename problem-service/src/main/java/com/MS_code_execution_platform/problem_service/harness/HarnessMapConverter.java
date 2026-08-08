package com.MS_code_execution_platform.problem_service.harness;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.io.UncheckedIOException;
import java.util.Map;

/**
 * Persists Problem.harnessByLanguage (language -> generated boilerplate) as
 * a single JSON TEXT column instead of one column per language - see
 * Problem.harnessByLanguage's comment for why.
 */
@Converter
public class HarnessMapConverter implements AttributeConverter<Map<String, String>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(Map<String, String> attribute) {
        if (attribute == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(attribute);
        } catch (Exception e) {
            throw new UncheckedIOException("failed to serialize harnessByLanguage", new java.io.IOException(e));
        }
    }

    @Override
    public Map<String, String> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(dbData, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            throw new UncheckedIOException("failed to deserialize harnessByLanguage", new java.io.IOException(e));
        }
    }
}
