package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResult;
import com.MS_code_execution_platform.worker_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.worker_service.messaging.ResultProducer;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;


@Service
@RequiredArgsConstructor
public class CodeExecutionService {

    private final DockerSandboxService dockerSandboxService;
    private final ResultProducer resultProducer;
    private final ObjectMapper objectMapper;

    private final Map<String, LanguageStrategy> languageStrategies;

    public void execute(String submissionJson) {

        try {

            // 1️⃣ Convert JSON → SubmissionRequest
            SubmissionRequest request =
                    objectMapper.readValue(submissionJson, SubmissionRequest.class);

            // 2️⃣ Get strategy based on language
            LanguageStrategy strategy =
                    languageStrategies.get(request.getLanguage().toLowerCase());

            if (strategy == null) {
                throw new RuntimeException("Unsupported Language");
            }

            // 3️⃣ Execute inside secure docker
            String output =
                    dockerSandboxService.execute(request, strategy);

            // 4️⃣ Build result
            ExecutionResult result = new ExecutionResult();
            result.setSubmissionId(request.getSubmissionId());
            result.setStatus("SUCCESS");
            result.setOutput(output);

            // 5️⃣ Send result back
            resultProducer.sendResult(result);

        } catch (Exception e) {

            ExecutionResult result = new ExecutionResult();
            result.setStatus("ERROR");
            result.setError(e.getMessage());

            resultProducer.sendResult(result);
        }
    }
}