package com.MS_code_execution_platform.worker_service.service;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.command.CreateContainerResponse;
import com.github.dockerjava.api.model.Bind;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.HostConfig;
import com.github.dockerjava.api.model.Volume;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.httpclient5.ApacheDockerHttpClient;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.TimeUnit;

@Service
public class DockerExecutionService {

    private final DockerClient dockerClient;

    public DockerExecutionService() {

        DefaultDockerClientConfig config =
                DefaultDockerClientConfig.createDefaultConfigBuilder()
                        .withDockerHost("npipe:////./pipe/docker_engine")
                        .build();

        ApacheDockerHttpClient httpClient =
                new ApacheDockerHttpClient.Builder()
                        .dockerHost(config.getDockerHost())
                        .build();

        this.dockerClient =
                DockerClientImpl.getInstance(config, httpClient);
    }

    public String execute(String directory,
                          String image,
                          String command) throws Exception {

        dockerClient.pullImageCmd(image).start().awaitCompletion();

        String linuxPath = directory.replace("\\", "/");

        CreateContainerResponse container =
                dockerClient.createContainerCmd(image)
                        .withHostConfig(
                                HostConfig.newHostConfig()
                                        .withBinds(new Bind(linuxPath, new Volume("/app")))
                        )
                        .withWorkingDir("/app")
                        .withCmd("sh", "-c", command)
                        .exec();

        String containerId = container.getId();

        dockerClient.startContainerCmd(containerId).exec();

        // ✅ WAIT FOR CONTAINER TO FINISH
        dockerClient.waitContainerCmd(containerId)
                .start()
                .awaitStatusCode();

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        dockerClient.logContainerCmd(containerId)
                .withStdOut(true)
                .withStdErr(true)
                .exec(new com.github.dockerjava.api.async.ResultCallback.Adapter<Frame>() {
                    @Override
                    public void onNext(Frame frame) {
                        try {
                            outputStream.write(frame.getPayload());
                        } catch (Exception ignored) {}
                    }
                })
                .awaitCompletion();

        dockerClient.removeContainerCmd(containerId)
                .withForce(true)
                .exec();

        String result = outputStream.toString();
        System.out.println("CONTAINER RAW OUTPUT: >>>" + result + "<<<");

        return result.trim();
    }

}