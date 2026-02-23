package com.MS_code_execution_platform.worker_service.service;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.model.*;
import com.github.dockerjava.core.DockerClientBuilder;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

@Service
public class DockerExecutionService {

    private final DockerClient dockerClient = DockerClientBuilder.getInstance().build();

    public String execute(Path codeDir, String image, String command) throws Exception {

        HostConfig hostConfig = HostConfig.newHostConfig()
                .withMemory(256 * 1024 * 1024L)
                .withCpuCount(1L)
                .withNetworkMode("none")
                .withBinds(new Bind(
                        codeDir.toAbsolutePath().toString(),
                        new Volume("/app")
                ));

        String containerId = dockerClient.createContainerCmd(image)
                .withHostConfig(hostConfig)
                .withWorkingDir("/app")
                .withCmd("sh", "-c", command)
                .exec()
                .getId();

        dockerClient.startContainerCmd(containerId).exec();

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        dockerClient.logContainerCmd(containerId)
                .withStdOut(true)
                .withStdErr(true)
                .withFollowStream(true)
                .exec(new com.github.dockerjava.api.async.ResultCallback.Adapter<>() {
                    @Override
                    public void onNext(Frame frame) {
                        try {
                            outputStream.write(frame.getPayload());
                        } catch (Exception ignored) {}
                    }
                }).awaitCompletion(5, TimeUnit.SECONDS);

        dockerClient.removeContainerCmd(containerId).withForce(true).exec();

        return outputStream.toString();
    }
}