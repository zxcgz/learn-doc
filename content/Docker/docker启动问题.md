# docker启动问题

1.  failed to start daemon: Error initializing network controller: error creating default "bridge" network: cannot create network 1acbea824eeadf1f581427f877ee7a75d0bea1be3802f7676cc4d6e6afc7cfff (docker0): conflicts with network 39ee42bbe7cc0cd023d175bed9d9b2ef4d59c63dc1fac4af537073434aa5972c (docker0): networks have same bridge name
    

删除docker网络sudo rm -rf /var/lib/docker/network

docker在底层操作了iptable，绕过了firewalld，在docker容器中映射的端口不要在firewall中再次添加，可能会导致docker容器无法启动或者docker服务无法启动