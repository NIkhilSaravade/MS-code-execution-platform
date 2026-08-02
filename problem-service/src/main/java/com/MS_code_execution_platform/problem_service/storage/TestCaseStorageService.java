package com.MS_code_execution_platform.problem_service.storage;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.nio.charset.StandardCharsets;

/**
 * Test-case content (input/expected output) lives in S3, not Postgres -
 * worker-service-go downloads it directly by key rather than round-tripping
 * it through problem-service on every execution. The 'input'/'expectedOutput'
 * TEXT columns on TestCase are kept alongside this for the older Java
 * worker-service, which still expects inline content on GET /problems/{id}/testcases.
 */
@Service
@RequiredArgsConstructor
public class TestCaseStorageService {

    private final S3Client s3Client;

    @Value("${s3.bucket-test-cases}")
    private String bucket;

    public String upload(Long problemId, int ordinal, String suffix, String content) {
        String key = "test-cases/%d/%d/%s.txt".formatted(problemId, ordinal, suffix);

        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(key)
                        .build(),
                RequestBody.fromString(content == null ? "" : content, StandardCharsets.UTF_8));

        return key;
    }
}
