package com.MS_code_execution_platform.solution_service.storage;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.io.UncheckedIOException;

/**
 * Uploads/downloads each problem's step-through visualizer HTML to the
 * platform-solution-assets bucket. Key convention: solutions/{problemId}/visualizer.html
 * - one visualizer per problem, so re-uploading just overwrites the same key
 * rather than accumulating versions (unlike submission-service's per-submission keys).
 */
@Service
@RequiredArgsConstructor
public class SolutionAssetStorageService {

    private final S3Client s3Client;

    @Value("${s3.bucket-solution-assets}")
    private String bucket;

    public String uploadVisualizer(Long problemId, MultipartFile file) {
        String key = visualizerKey(problemId);
        try {
            s3Client.putObject(
                    PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(key)
                            .contentType("text/html; charset=utf-8")
                            .build(),
                    RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read uploaded visualizer file", e);
        }
        return key;
    }

    public void delete(String key) {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    }

    public byte[] download(String key) {
        ResponseBytes<GetObjectResponse> object = s3Client.getObjectAsBytes(
                GetObjectRequest.builder().bucket(bucket).key(key).build());
        return object.asByteArray();
    }

    private String visualizerKey(Long problemId) {
        return "solutions/%d/visualizer.html".formatted(problemId);
    }
}
